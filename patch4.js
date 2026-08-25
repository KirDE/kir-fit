const fs = require('fs');
let code = fs.readFileSync('apps/api/src/server.ts', 'utf8');

code = code.replace(
  'allowCredentials: user.authenticators.map(a => ({\n      id: a.credentialID,\n      transports: a.transports ? a.transports.split(",") : undefined,\n    })),',
  'allowCredentials: user.authenticators.map(a => ({\n      id: a.credentialID,\n      transports: a.transports ? (a.transports.split(",") as any) : undefined,\n    })),'
);

fs.writeFileSync('apps/api/src/server.ts', code);
