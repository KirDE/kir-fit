const fs = require('fs');
let code = fs.readFileSync('apps/api/src/server.ts', 'utf8');

code = code.replace(
  'const { credentialPublicKey, credentialID, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;',
  'const cred = verification.registrationInfo.credential; const { id, publicKey, counter } = cred; const { credentialDeviceType, credentialBackedUp } = verification.registrationInfo;'
);

code = code.replace(
  'credentialID: Buffer.from(credentialID).toString("base64url"),',
  'credentialID: id,'
);

code = code.replace(
  'credentialPublicKey: Buffer.from(credentialPublicKey),',
  'credentialPublicKey: Buffer.from(publicKey),'
);

code = code.replace(
  'allowCredentials: user.authenticators.map(a => ({\n      id: Buffer.from(a.credentialID, \'base64url\'),',
  'allowCredentials: user.authenticators.map(a => ({\n      id: a.credentialID,'
);

code = code.replace(
  'authenticator: {\n      credentialPublicKey: auth.credentialPublicKey,\n      credentialID: Buffer.from(auth.credentialID, \'base64url\'),\n      counter: Number(auth.counter),\n      transports: auth.transports ? auth.transports.split(\',\') : undefined\n    }',
  'authenticator: {\n      credentialPublicKey: Uint8Array.from(auth.credentialPublicKey),\n      credentialID: auth.credentialID,\n      counter: Number(auth.counter),\n      transports: auth.transports ? auth.transports.split(\',\') : undefined\n    } as any'
);

fs.writeFileSync('apps/api/src/server.ts', code);
