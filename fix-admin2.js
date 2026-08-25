const fs = require('fs');
let code = fs.readFileSync('apps/web/src/main.tsx', 'utf8');

code = code.replace(
  'const [daysSaved, setDaysSaved] = useState(false);',
  'const [daysSaved, setDaysSaved] = useState(false);\n  const [displayName, setDisplayName] = useState("");\n  const [profileSaved, setProfileSaved] = useState(false);'
);
code = code.replace(
  'api("/settings/program").then((x) => setWeekdays(x.preferredWeekdays));',
  'api("/settings/program").then((x) => setWeekdays(x.preferredWeekdays));\n    api("/dashboard").then((x) => setDisplayName(x.displayName || ""));'
);

fs.writeFileSync('apps/web/src/main.tsx', code);
