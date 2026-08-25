const fs = require('fs');
let code = fs.readFileSync('apps/api/src/server.ts', 'utf8');

code = code.replace(
  'transports: auth.transports ? auth.transports.split(",") : undefined,',
  'transports: auth.transports ? auth.transports.split(",") as any : undefined,'
);

code = code.replace(
  'authenticator: {\n      credentialPublicKey: Uint8Array.from(auth.credentialPublicKey),\n      credentialID: auth.credentialID,\n      counter: Number(auth.counter),\n      transports: auth.transports ? auth.transports.split(\',\') : undefined\n    } as any',
  `credential: {
      id: auth.credentialID,
      publicKey: Uint8Array.from(auth.credentialPublicKey),
      counter: Number(auth.counter),
      transports: auth.transports ? auth.transports.split(',') as any : undefined
    } as any`
);

fs.writeFileSync('apps/api/src/server.ts', code);
