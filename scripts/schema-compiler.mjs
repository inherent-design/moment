import ts from 'typescript-schema';
import { primitives } from '../runtime/input-schemas.mjs';

/** Ship only reachable local definitions; tool selection must stay lightweight. */
export function pruneSchema(document) {
  if(typeof document==='boolean') return document;
  const {$defs={},...root}=document,selected=new Map(),queue=[];
  const visit=node=>{
    if(!node || typeof node!=='object') return;
    if(node.$ref!==undefined) {
      if(typeof node.$ref!=='string' || !/^#\/\$defs\/[^/]+$/.test(node.$ref)) throw new Error('Generated schema reference must resolve locally');
      const name=node.$ref.slice(8);
      if(!Object.hasOwn($defs,name)) throw new Error(`Unresolved schema reference: ${node.$ref}`);
      if(!selected.has(name)) {selected.set(name,$defs[name]);queue.push($defs[name]);}
    }
    for(const child of Object.values(node)) visit(child);
  };
  visit(root);while(queue.length) visit(queue.shift());
  return {...root,...(selected.size?{$defs:Object.fromEntries([...selected].sort(([a],[b])=>a.localeCompare(b,'en')))}:{})};
}

/** Deliberately closed subset: unsupported types fail instead of becoming any. */
export function compileContract(filename) {
  const program = ts.createProgram([filename], { strict: true, noEmit: true, target: ts.ScriptTarget.ESNext });
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => '.', getCanonicalFileName: x => x, getNewLine: () => '\n' }));
  const checker = program.getTypeChecker(), source = program.getSourceFile(filename);
  const declarations = new Map(source.statements.filter(n => n.name).map(n => [n.name.text, n]));
  const interfaceType = name => {
    const declaration = declarations.get(name);
    if (!declaration) throw new Error(`Missing interface ${name}`);
    return checker.getTypeAtLocation(declaration);
  };
  function document(type, wrapResult = false) {
    const defs = {}, seen = new Map();
    function schema(t) {
      const f = t.flags;
      if (f & ts.TypeFlags.StringLiteral) return { const: t.value };
      if (f & ts.TypeFlags.NumberLiteral) return { const: t.value };
      if (f & ts.TypeFlags.BooleanLiteral) return { const: t.intrinsicName === 'true' };
      if (f & ts.TypeFlags.Null) return { type: 'null' };
      if (f & ts.TypeFlags.String) return { type: 'string' };
      if (f & ts.TypeFlags.Number) return { type: 'number' };
      if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
      if (f & ts.TypeFlags.Never) return false;
      if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.TypeParameter)) throw new Error(`Unsupported boundary type: ${checker.typeToString(t)}`);
      if (t.isUnion()) return { anyOf: t.types.map(schema) };
      if (!(f & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) throw new Error(`Unsupported boundary type: ${checker.typeToString(t)}`);
      if (checker.isTupleType(t) || t.getCallSignatures().length || t.getConstructSignatures().length) throw new Error(`Unsupported callable/tuple: ${checker.typeToString(t)}`);
      if (seen.has(t)) return { $ref: `#/$defs/${seen.get(t)}` };
      const name = `t${seen.size}`;seen.set(t, name);defs[name] = {};
      if (checker.isArrayType(t)) defs[name] = { type: 'array', items: schema(checker.getTypeArguments(t)[0]) };
      else {
        const properties = {}, required = [];
        for (const prop of checker.getPropertiesOfType(t)) {
          let value = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? source);
          const annotation=prop.valueDeclaration?.type;
          const primitive=annotation && ts.isTypeReferenceNode(annotation)?primitives[annotation.typeName.getText(source)]:undefined;
          if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.name);
          else if (value.isUnion()) {
            const values = value.types.filter(x => !(x.flags & ts.TypeFlags.Undefined));
            properties[prop.name] = primitive ?? (values.length === 1 ? schema(values[0]) : { anyOf: values.map(schema) });continue;
          }
          properties[prop.name] = primitive ?? schema(value);
        }
        if (checker.getIndexTypeOfType(t, ts.IndexKind.Number)) throw new Error(`Unsupported numeric index: ${checker.typeToString(t)}`);
        const index = checker.getIndexTypeOfType(t, ts.IndexKind.String);
        defs[name] = { type: 'object', properties, required, additionalProperties: index ? schema(index) : false };
      }
      return { $ref: `#/$defs/${name}` };
    }
    let root = schema(type);
    if (root.$ref) root = { ...defs[root.$ref.split('/').at(-1)] };
    if (wrapResult) {
      const fault = schema(interfaceType('Fault'));
      const result = { anyOf: [
        { type: 'object', properties: { ok: { const: true }, value: root }, required: ['ok', 'value'], additionalProperties: false },
        { type: 'object', properties: { ok: { const: false }, error: fault }, required: ['ok', 'error'], additionalProperties: false },
      ] };
      root = { type: 'object', properties: { operation: { type: 'string' }, catalog: schema(interfaceType('CatalogIdentity')), result }, required: ['operation', 'catalog', 'result'], additionalProperties: false };
    }
    return pruneSchema(typeof root==='boolean' ? root : { ...root, ...(Object.keys(defs).length ? { $defs: defs } : {}) });
  }
  const methods = new Map();
  for (const owner of ['Methods', 'ManagedMethods']) for (const prop of checker.getPropertiesOfType(interfaceType(owner))) {
    const type = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration);
    const member = name => checker.getTypeOfSymbolAtLocation(type.getProperty(name), prop.valueDeclaration);
    methods.set(prop.name, { input: document(member('input')), output: document(member('output')), envelope: document(member('output'), true) });
  }
  methods.surfaces=Object.fromEntries(['AgentManifest','AgentRecord','StatusEnvelope','StopEnvelope','IntegrationEnvelope'].map(name=>[name,document(interfaceType(name))]));
  return methods;
}
