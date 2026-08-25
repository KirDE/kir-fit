const fs = require('fs');
let code = fs.readFileSync('apps/web/src/main.tsx', 'utf8');

if (!code.includes('const [displayName, setDisplayName] = useState("");')) {
    code = code.replace(
        'const [daysSaved, setDaysSaved] = useState(false);',
        'const [daysSaved, setDaysSaved] = useState(false);\n  const [displayName, setDisplayName] = useState("");\n  const [profileSaved, setProfileSaved] = useState(false);'
    );
}
fs.writeFileSync('apps/web/src/main.tsx', code);
