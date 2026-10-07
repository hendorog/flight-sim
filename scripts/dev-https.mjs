#!/usr/bin/env node
// Dev server over HTTPS on all interfaces, for flying from another device on the network. Sound (AudioWorklet)
// and some other browser features only work in a secure context: https, or http://localhost. Generates a
// self-signed certificate with openssl on first use (the browser will ask you to accept it once).
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'node_modules/.cache/dev-https');
const key = resolve(dir, 'key.pem');
const cert = resolve(dir, 'cert.pem');
if (!existsSync(key) || !existsSync(cert)) {
  mkdirSync(dir, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=flight-sim-dev',
    '-keyout', key, '-out', cert], { stdio: 'ignore' });
}
const server = await createServer({ root, server: { host: true, https: { key: readFileSync(key), cert: readFileSync(cert) } } });
await server.listen();
server.printUrls();
