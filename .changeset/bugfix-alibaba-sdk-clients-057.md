---
"@componode/importer-alibaba-cloud": patch
---

Alibaba Cloud importer SDK client fixes (spec `057-bugfix-alibaba-sdk-clients`, GitHub issues #231/#232): SDK client constructors resolve through a `.default`-unwrapping interop fallback so `new Client()` works under bundled CJS runtimes; new `region`, `stsEndpoint`, `bssEndpoint` config fields pin/redirect all three clients — STS/BSS fall back to their documented global endpoints, and endpoint URLs normalize to host[:port] + protocol at the SDK boundary.
