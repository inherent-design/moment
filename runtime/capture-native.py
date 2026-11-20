"""Darwin exact-byte clone adapter. The owner-local controller supplies custody.

No general retirement, archive extraction, fixture bypass, or caller-selected code.
All checks are explicit (also under python -O). Process interruption is qualified;
neither a cooperative lock nor fsync is a power-loss or isolation guarantee.
"""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def pairs_unique(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def nonfinite(value):
    raise RuntimeError('Non-finite JSON value: ' + value)


def decode(raw):
    return json.loads(raw, object_pairs_hook=pairs_unique, parse_constant=nonfinite)


require(sys.platform == 'darwin', 'Darwin clone adapter unavailable')
LIB = C.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)


class Attr(C.Structure):
    _fields_ = [('count', C.c_uint16), ('reserved', C.c_uint16),
                ('common', C.c_uint32), ('vol', C.c_uint32),
                ('directory', C.c_uint32), ('file', C.c_uint32), ('fork', C.c_uint32)]


class TS(C.Structure):
    _fields_ = [('sec', C.c_long), ('ns', C.c_long)]


class Birth(C.Structure):
    _pack_ = 4
    _fields_ = [('length', C.c_uint32), ('ts', TS)]


def native(result):
    if result:
        raise OSError(C.get_errno(), os.strerror(C.get_errno()))


def birth(fd):
    attr, value = Attr(5, 0, 0x200, 0, 0, 0, 0), Birth()
    native(LIB.fgetattrlist(fd, C.byref(attr), C.byref(value), C.sizeof(value), 0))
    require(value.length == C.sizeof(value), 'Unsupported birthtime representation')
    return [value.ts.sec, value.ts.ns]


def birth_set(fd, value):
    attr, stamp = Attr(5, 0, 0x200, 0, 0, 0, 0), TS(*value)
    native(LIB.fsetattrlist(fd, C.byref(attr), C.byref(stamp), C.sizeof(stamp), 0))


def strict_parent(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Unsafe absolute path')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parent.parts[1:]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def digest_fd(fd, maximum):
    os.lseek(fd, 0, os.SEEK_SET)
    result, total = hashlib.sha256(), 0
    while True:
        block = os.read(fd, min(1048576, maximum - total + 1))
        if not block:
            return result.hexdigest()
        total += len(block)
        require(total <= maximum, 'File exceeded the bounded observation')
        result.update(block)


def snapshot(path, maximum):
    path = Path(path)
    directory = strict_parent(path)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        before = os.fstat(fd)
        require(os.stat(path.name, dir_fd=directory, follow_symlinks=False).st_ino == before.st_ino,
                'Path identity changed before observation')
    finally:
        os.close(directory)
    try:
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_flags == 0,
                'Only unflagged independent regular files qualify')
        require(before.st_uid == os.getuid() and before.st_size <= maximum,
                'File ownership or byte budget differs')
        require(not before.st_mode & (stat.S_ISUID | stat.S_ISGID), 'Special permission bits unsupported')
        require(not subprocess.check_output(['/bin/ls', '-lde', str(path)], text=True).splitlines()[1:],
                'ACL preservation is not qualified')
        names = subprocess.check_output(['/usr/bin/xattr', str(path)], text=True).splitlines()
        require(set(names) <= {'com.apple.provenance'}, 'Extended attribute preservation is not qualified')
        attrs = {name: hashlib.sha256(subprocess.check_output(
            ['/usr/bin/xattr', '-px', name, str(path)])).hexdigest() for name in names}
        sha, born, after = digest_fd(fd, maximum), birth(fd), os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                'File changed during observation')
        require(os.lstat(path).st_ino == before.st_ino and not os.path.islink(path),
                'Path changed during metadata observation')
        return dict(dev=str(before.st_dev), ino=str(before.st_ino), size=before.st_size, sha256=sha,
                    mode=stat.S_IMODE(before.st_mode), uid=before.st_uid, gid=before.st_gid,
                    flags=before.st_flags, attrs=attrs, birth=born, mtime_ns=str(before.st_mtime_ns),
                    atime_ns=str(before.st_atime_ns), ctime_ns=str(before.st_ctime_ns),
                    allocated=before.st_blocks * 512)
    finally:
        os.close(fd)


SEMANTIC = ['dev', 'size', 'sha256', 'mode', 'uid', 'gid', 'flags', 'attrs', 'birth', 'mtime_ns']


def equivalent(a, b):
    return all(a[k] == b[k] for k in SEMANTIC)


def exact(a, b):
    return equivalent(a, b) and a['ino'] == b['ino'] and a['ctime_ns'] == b['ctime_ns']


def save(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + str(os.getpid()) + '.publishing')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = strict_parent(path)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def guarded_path(path, roots, protected, components):
    path = Path(path)
    require(any(path != Path(root) and path.is_relative_to(Path(root)) for root in roots),
            'File is outside the admitted capture roots')
    require(not any(path == Path(p) or path.is_relative_to(Path(p)) for p in protected),
            'Protected capture subtree')
    # The controller projects this domain policy from the executed core. Path
    # confinement and saved-world observations remain physical adapter checks.
    forbidden = set(components)
    require(not any(forbidden.intersection(part.lower() for part in path.relative_to(Path(root)).parts)
                    for root in roots if path != Path(root) and path.is_relative_to(Path(root))),
            'Protected capture category')
    for parent in path.parents:
        if not any(parent == Path(r) or parent.is_relative_to(Path(r)) for r in roots):
            break
        require(not (parent / 'level.dat').exists() and not (parent / 'level.dat_old').exists(),
                'Saved world boundary')


def read_private(path, maximum=524288):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                'Private custody file is unavailable')
        raw = os.read(fd, maximum + 1)
        require(len(raw) <= maximum, 'Custody file exceeds its bound')
        return raw
    finally:
        os.close(fd)


def custody(request, plan):
    require(os.getppid() == request['controllerPid'], 'The owning controller has retired')
    for name, expected in [('policyFile', 'policyDigest'), ('custodyFile', 'custodyDigest')]:
        raw = read_private(plan[name])
        require('sha256:' + hashlib.sha256(raw).hexdigest() == plan[expected],
                'Policy or writer custody changed')
    lock = decode(read_private(request['scopeLock']))
    require(lock['pid'] == request['controllerPid'] and lock['operationDigest'] == request['planDigest'],
            'Cooperative capture scope custody changed')
    require(lock['target'] == plan['target'], 'Scope identity changed')


def open_guard(paths):
    result = subprocess.run(['/usr/sbin/lsof', '-nP', '-F', 'pn', '--'] + list(map(str, paths)),
                            capture_output=True, text=True, timeout=20)
    require(result.returncode in [0, 1] and not result.stderr.strip(), 'Open-file observation is incomplete')
    pid = None
    for line in result.stdout.splitlines():
        if line.startswith('p'):
            pid = int(line[1:])
        if line.startswith('n') and pid not in [os.getpid(), os.getppid()]:
            require(False, 'Selected capture is open in another process')


def journal_state(value, plan, identity):
    require(isinstance(value, dict) and {'planDigest', 'items'} <= set(value) and
            set(value) <= {'formatVersion', 'planDigest', 'items'}, 'Unsupported clone journal shape')
    require('formatVersion' not in value or type(value['formatVersion']) is int and value['formatVersion'] == 1,
            'Unsupported clone journal version')
    require(value['planDigest'] == identity and isinstance(value['items'], dict), 'Journal names another exact plan')
    fields = {'dev', 'ino', 'size', 'sha256', 'mode', 'uid', 'gid', 'flags', 'attrs',
              'birth', 'mtime_ns', 'atime_ns', 'ctime_ns', 'allocated'}
    for key, item in value['items'].items():
        require(isinstance(key, str) and key.isascii() and key.isdigit() and
                str(int(key)) == key and 0 <= int(key) < len(plan['items']), 'Invalid clone journal index')
        require(isinstance(item, dict) and {'stage', 'phase'} <= set(item) and
                set(item) <= {'stage', 'phase', 'clone', 'done', 'after'}, 'Unsupported clone item shape')
        phase = item['phase']
        require(phase in ['staging', 'prepared', 'swapped', 'complete'], 'Unsupported clone journal phase')
        expected = Path(plan['items'][int(key)]['target']).with_name('.moment-share-' + identity[7:27] + '-' + key)
        require(item['stage'] == str(expected), 'Clone journal staging identity differs')
        require('done' not in item or type(item['done']) is bool, 'Invalid clone completion flag')
        require((item.get('done') is True) == (phase == 'complete'), 'Clone completion and phase disagree')
        require(phase == 'staging' or 'clone' in item, 'Prepared clone identity is missing')
        require(phase != 'complete' or 'after' in item, 'Completed clone evidence is missing')
        require(phase == 'complete' or 'after' not in item, 'Unsettled clone claims completed evidence')
        for name in ['clone', 'after']:
            if name not in item:
                continue
            observed = item[name]
            require(isinstance(observed, dict) and set(observed) == fields, 'Unsupported clone evidence format')
            require(all(type(observed[field]) is int and 0 <= observed[field] <= 9007199254740991
                        for field in ['size', 'mode', 'uid', 'gid', 'flags', 'allocated']), 'Invalid clone evidence quantity')
            require(all(isinstance(observed[field], str) for field in
                        ['dev', 'ino', 'sha256', 'mtime_ns', 'atime_ns', 'ctime_ns']), 'Invalid clone evidence identity')
            require(isinstance(observed['attrs'], dict) and all(isinstance(k, str) and isinstance(v, str)
                    for k, v in observed['attrs'].items()), 'Invalid clone attribute observations')
            require(isinstance(observed['birth'], list) and len(observed['birth']) == 2 and
                    all(type(n) is int for n in observed['birth']) and 0 <= observed['birth'][1] < 1000000000,
                    'Invalid clone birth-time observation')
    return value


def apply_one(request):
    plan, identity, index = request['plan'], request['planDigest'], request['index']
    require(plan['operation'] == 'exact-share' and 0 <= index < len(plan['items']), 'Invalid clone selection')
    row, maximum = plan['items'][index], request['maximumBytes']
    source, target = Path(row['source']), Path(row['target'])
    for path in [source, target]:
        guarded_path(path, plan['roots'], plan['protectedPaths'], request['protectedComponents'])
    journal_path = Path(request['journalPath'])
    state = journal_state(decode(read_private(journal_path)), plan, identity) if journal_path.exists() else dict(formatVersion=1, planDigest=identity, items={})
    key = str(index)
    item = state['items'].get(key)
    if item and item.get('done') is True:
        return item  # Never inspect or replace a later restored path on exact replay.
    stage = target.with_name('.moment-share-' + identity[7:27] + '-' + key)
    custody(request, plan)
    if not item:
        require(not stage.exists() and not stage.is_symlink(), 'Unexpected clone staging exists')
        require(exact(snapshot(source, maximum), row['source_before']) and
                exact(snapshot(target, maximum), row['before']), 'Source or target changed since preview')
        require(all(row['source_before'][k] == row['before'][k]
                    for k in ['size', 'sha256', 'mode', 'uid', 'gid', 'flags', 'attrs']),
                'Byte or preservation metadata differs')
        open_guard([source, target])
        item = dict(stage=str(stage), phase='staging')
        state['items'][key] = item
        save(journal_path, state)
        sfd, directory = os.open(source, os.O_RDONLY | os.O_NOFOLLOW), strict_parent(target)
        try:
            require(str(os.fstat(sfd).st_ino) == row['source_before']['ino'], 'Source changed before cloning')
            native(LIB.fclonefileat(sfd, directory, os.fsencode(stage.name), 0))
            fd = os.open(stage.name, os.O_RDWR | os.O_NOFOLLOW, dir_fd=directory)
            try:
                birth_set(fd, row['before']['birth'])
                os.utime(fd, ns=(int(row['before']['atime_ns']), int(row['before']['mtime_ns'])))
                os.fsync(fd)
            finally:
                os.close(fd)
            os.fsync(directory)
        finally:
            os.close(sfd)
            os.close(directory)
        clone = snapshot(stage, maximum)
        require(equivalent(clone, row['before']) and clone['ino'] != row['before']['ino'],
                'Clone preservation failed')
        item.update(phase='prepared', clone=clone)
        save(journal_path, state)
    if item['phase'] == 'staging':
        require(request.get('reconcile') is True, 'Incomplete clone preparation; use explicit reconciliation')
        require(exact(snapshot(source, maximum), row['source_before']) and
                exact(snapshot(target, maximum), row['before']), 'Originals changed during interrupted preparation')
        custody(request, plan)
        if not stage.exists() and not stage.is_symlink():
            del state['items'][key]
            save(journal_path, state)
            return apply_one(request)
        candidate = snapshot(stage, maximum)
        require(all(candidate[k] == row['before'][k] for k in
                    ['dev', 'size', 'sha256', 'mode', 'uid', 'gid', 'flags', 'attrs']) and
                candidate['ino'] not in [row['before']['ino'], row['source_before']['ino']],
                'Interrupted staging is not an exact owned candidate; preserve it')
        open_guard([source, target, stage])
        fd = os.open(stage, os.O_RDWR | os.O_NOFOLLOW)
        try:
            require(str(os.fstat(fd).st_ino) == candidate['ino'], 'Staging changed during reconciliation')
            birth_set(fd, row['before']['birth'])
            os.utime(fd, ns=(int(row['before']['atime_ns']), int(row['before']['mtime_ns'])))
            os.fsync(fd)
        finally:
            os.close(fd)
        candidate = snapshot(stage, maximum)
        require(equivalent(candidate, row['before']), 'Reconciled staging metadata differs')
        item.update(phase='prepared', clone=candidate)
        save(journal_path, state)
    current = snapshot(target, maximum)
    if current['ino'] == row['before']['ino']:
        require(exact(current, row['before']) and exact(snapshot(stage, maximum), item['clone']) and
                exact(snapshot(source, maximum), row['source_before']), 'Preview or staging identity changed')
        custody(request, plan)
        open_guard([source, target, stage])
        directory = strict_parent(target)
        try:
            native(LIB.renameatx_np(directory, os.fsencode(target.name), directory,
                                   os.fsencode(stage.name), 0x2 | 0x10))
            os.fsync(directory)
        finally:
            os.close(directory)
    current = snapshot(target, maximum)
    require(current['ino'] == item['clone']['ino'] and equivalent(current, row['before']),
            'Unexpected replacement; retain both paths')
    item['phase'] = 'swapped'
    save(journal_path, state)
    if stage.exists() or stage.is_symlink():
        old = snapshot(stage, maximum)
        require(old['ino'] == row['before']['ino'] and equivalent(old, row['before']),
                'Moved original differs; preserve it')
        custody(request, plan)
        open_guard([source, target, stage])
        directory = strict_parent(target)
        try:
            check = os.stat(stage.name, dir_fd=directory, follow_symlinks=False)
            require(str(check.st_ino) == old['ino'] and str(check.st_mtime_ns) == old['mtime_ns'],
                    'Quarantined object changed')
            os.unlink(stage.name, dir_fd=directory)
            os.fsync(directory)
        finally:
            os.close(directory)
    require(equivalent(snapshot(target, maximum), row['before']) and
            exact(snapshot(source, maximum), row['source_before']), 'Post-cutover evidence differs')
    item.update(done=True, phase='complete', after=snapshot(target, maximum))
    save(journal_path, state)
    return item


def main():
    try:
        raw = sys.stdin.buffer.read(524289)
        require(len(raw) <= 524288, 'Native capture request exceeds512KiB')
        request = decode(raw)
        require(type(request['formatVersion']) is int and request['formatVersion'] == 2, 'Unsupported native capture protocol')
        components = request.get('protectedComponents')
        require(isinstance(components, list) and 1 <= len(components) <= 64 and
                all(isinstance(part, str) and 0 < len(part) <= 128 and part == part.lower() and
                    '/' not in part and '\\' not in part for part in components), 'Unsupported protection projection')
        if sys.argv[1] == 'inspect':
            require(len(request['paths']) <= 128, 'Too many paths')
            result = []
            for path in request['paths']:
                guarded_path(path, request['roots'], request['protectedPaths'], components)
                result.append(snapshot(path, request['maximumBytes']))
        elif sys.argv[1] == 'apply-one':
            result = apply_one(request)
        else:
            raise RuntimeError('Unsupported capture adapter operation')
        print(json.dumps(dict(ok=True, value=result)))
    except Exception as error:
        print(json.dumps(dict(ok=False, error=dict(code='CAPABILITY_UNAVAILABLE',
                         message=str(error), retry='reconcile'))))
        sys.exit(1)


if __name__ == '__main__':
    main()
