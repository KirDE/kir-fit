const fs = require('fs');
let code = fs.readFileSync('apps/web/src/main.tsx', 'utf8');

code = code.replace(
  /function Admin\(\{ logout \}: \{ logout: \(\) => void \}\) \{([\s\S]*?)const load = \(\) => api\("\/exercises"\)\.then\(setItems\);/m,
  `function Admin({ logout }: { logout: () => void }) {
  const [items, setItems] = useState<Exercise[]>();
  const [weekdays, setWeekdays] = useState<number[]>();
  const [daysSaved, setDaysSaved] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const load = () => api("/exercises").then(setItems);`
);

fs.writeFileSync('apps/web/src/main.tsx', code);
