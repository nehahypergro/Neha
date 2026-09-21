import io, sys, zipfile, urllib.request, re
URL = "https://mitpl.sgp1.digitaloceanspaces.com/SL74DVD.zip"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
class HTTPRangeFile(io.RawIOBase):
    CHUNK = 4 * 1024 * 1024
    def __init__(self, url):
        self.url = url; self.pos = 0; self.cache = {}; self.nreq = 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        if whence == 0: self.pos = off
        elif whence == 1: self.pos += off
        elif whence == 2: self.pos = self.size + off
        return self.pos
    def _chunk(self, idx):
        if idx not in self.cache:
            start = idx * self.CHUNK; end = min(start + self.CHUNK, self.size) - 1
            req = urllib.request.Request(self.url, headers={"User-Agent": UA, "Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                self.cache[idx] = r.read()
            self.nreq += 1
            if len(self.cache) > 12: self.cache.pop(next(iter(self.cache)))
        return self.cache[idx]
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.size:
            idx, off = divmod(self.pos, self.CHUNK)
            c = self._chunk(idx); take = min(n, len(c) - off)
            out += c[off:off+take]; self.pos += take; n -= take
        return bytes(out)
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

f = HTTPRangeFile(URL)
print("size", f.size, file=sys.stderr)
z = zipfile.ZipFile(io.BufferedReader(f, buffer_size=1<<20))
names = z.namelist()
print("entries:", len(names), "| range requests:", f.nreq, file=sys.stderr)
mode = sys.argv[1] if len(sys.argv) > 1 else "list"
if mode == "list":
    pat = re.compile(sys.argv[2], re.I) if len(sys.argv) > 2 else re.compile(r"\.(ttf|otf|pfb|cab|msi|exe|7z|zip|rar)$", re.I)
    for n in names:
        if pat.search(n): print(z.getinfo(n).file_size, n)
elif mode == "dirs":
    tops = {}
    for n in names:
        k = "/".join(n.split("/")[:2]); tops[k] = tops.get(k, 0) + 1
    for k, v in sorted(tops.items()): print(v, k)
elif mode == "extract":
    import os
    pat = re.compile(sys.argv[2], re.I); dest = sys.argv[3]; os.makedirs(dest, exist_ok=True)
    for n in names:
        if pat.search(n) and not n.endswith("/"):
            data = z.read(n); p = os.path.join(dest, os.path.basename(n))
            open(p, "wb").write(data); print(len(data), p)
