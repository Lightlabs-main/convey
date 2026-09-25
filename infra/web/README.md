# Convey web edge

The Next.js app runs as `convey-web.service` on the supplied Lightsail VPS,
bound only to `127.0.0.1:3001`. `/etc/convey/web.env` contains only the
server-side loopback relay URL and the gateway bearer token; it does not share
the NodeFlare credential or any operator private key with the web process.

The public HTTPS reverse proxy is a separate Nginx site. It forwards browser
requests to this loopback service, so the browser can reach the same-origin
relay proxy without learning the private gateway address or token.

The current supplied-host deployment is
[https://conveyapp.site](https://conveyapp.site), with
[https://www.conveyapp.site](https://www.conveyapp.site) also configured.
Nginx owns TLS and proxies to `127.0.0.1:3001`; the private relay remains on
`127.0.0.1:8800`.
