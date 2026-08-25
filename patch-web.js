const fs = require('fs');
let code = fs.readFileSync('apps/web/src/main.tsx', 'utf8');

if (!code.includes('@simplewebauthn/browser')) {
  code = code.replace(
    'import { api, isGuest, setGuest, setToken, token, uuid } from "./api";',
    'import { api, isGuest, setGuest, setToken, token, uuid } from "./api";\nimport { startRegistration, startAuthentication } from "@simplewebauthn/browser";'
  );
}

// Add passkey UI in Login
const loginRegex = /function Login\(\{ done \}: \{ done: \(\) => void \}\) \{([\s\S]*?)<div className="login-top">/;
const passkeyState = `
  const [passkeyUsername, setPasskeyUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [passkeyErr, setPasskeyErr] = useState("");
  const [displayName, setDisplayName] = useState("");

  const handlePasskeyLogin = async (e: any) => {
    e.preventDefault();
    setPasskeyErr("");
    try {
      const opts = await api("/auth/webauthn/login-options", { method: "POST", body: JSON.stringify({ username: passkeyUsername }) });
      const asseResp = await startAuthentication({ optionsJSON: opts });
      const r = await api("/auth/webauthn/login-verify", { method: "POST", body: JSON.stringify({ username: passkeyUsername, response: asseResp }) });
      setGuest(false);
      setToken(r.token);
      done();
    } catch (err: any) {
      setPasskeyErr(err.message || "Login failed");
    }
  };

  const handlePasskeyRegister = async (e: any) => {
    e.preventDefault();
    setPasskeyErr("");
    try {
      const opts = await api("/auth/webauthn/register-options", { method: "POST", body: JSON.stringify({ username: passkeyUsername }) });
      const attResp = await startRegistration({ optionsJSON: opts });
      const r = await api("/auth/webauthn/register-verify", { method: "POST", body: JSON.stringify({ username: passkeyUsername, response: attResp }) });
      setGuest(false);
      setToken(r.token);
      
      if (displayName && displayName !== passkeyUsername) {
        await api("/settings/profile", { method: "PATCH", body: JSON.stringify({ displayName }) });
      }
      done();
    } catch (err: any) {
      setPasskeyErr(err.message || "Registration failed");
    }
  };
`;
if (!code.includes('handlePasskeyLogin')) {
  code = code.replace(/(function Login\(\{ done \}: \{ done: \(\) => void \}\) \{[\s\S]*?)(return \(\n    <div className="login">)/, `$1${passkeyState}\n  $2`);
}

const passkeyUI = `
      <form onSubmit={isRegistering ? handlePasskeyRegister : handlePasskeyLogin} className="passkey-login" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3>{isRegistering ? "Register with Passkey" : "Login with Passkey"}</h3>
        <label>
          Username
          <input value={passkeyUsername} onChange={(e) => setPasskeyUsername(e.target.value)} required />
        </label>
        {isRegistering && (
          <label>
            Display Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
        )}
        {passkeyErr && <p className="error">{passkeyErr}</p>}
        <button className="primary" type="submit">{isRegistering ? "Register" : "Login"}</button>
        <button type="button" onClick={() => setIsRegistering(!isRegistering)} style={{ background: 'transparent', color: 'var(--accent)', border: 'none' }}>
          {isRegistering ? "Already have an account? Login" : "Need an account? Register"}
        </button>
      </form>
`;

if (!code.includes('passkey-login')) {
  code = code.replace(/(<h1>\{tr\("signGoogle"\)\}<\/h1>)/, `$1\n${passkeyUI}`);
}

// Add display name editing in Admin
const adminState = `
  const [displayName, setDisplayName] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
`;
const adminLoad = `
    api("/dashboard").then((x) => setDisplayName(x.displayName));
`;

if (!code.includes('const [displayName, setDisplayName]')) {
  code = code.replace(/const \[daysSaved, setDaysSaved\] = useState\(false\);/, 'const [daysSaved, setDaysSaved] = useState(false);\n  const [displayName, setDisplayName] = useState("");\n  const [profileSaved, setProfileSaved] = useState(false);');
  code = code.replace('api("/settings/program").then((x) => setWeekdays(x.preferredWeekdays));', 'api("/settings/program").then((x) => setWeekdays(x.preferredWeekdays));\n    api("/dashboard").then((x) => setDisplayName(x.displayName || ""));');
}

const adminProfileUI = `
      <Card title="Profile">
        <label>
          Display Name
          <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setProfileSaved(false); }} />
        </label>
        <button
          className="primary"
          onClick={async () => {
            await api("/settings/profile", { method: "PATCH", body: JSON.stringify({ displayName }) });
            setProfileSaved(true);
          }}
        >
          {profileSaved ? tr("saved") : "Save Profile"}
        </button>
      </Card>
`;

if (!code.includes('title="Profile"')) {
  code = code.replace(/(<Card title=\{tr\("language"\)\}>)/, `${adminProfileUI}\n      $1`);
}

fs.writeFileSync('apps/web/src/main.tsx', code);
