# FIT application delivery state

- Domain: `fit.kir-it.de`
- Initial TaskFlow: `40b43181-3a83-47a1-a28a-6ef0ec1d9e7a`
- Enhancement TaskFlow: `a8d76a80-33aa-4f97-9781-658f8205bf66`
- Requested: 2026-08-24, Telegram topic 162
- Status: completed and verified
- Repository: `KirDE/kir-fit`, branch `main`
- Production: `https://fit.kir-it.de`, Docker stack healthy on nc.lighthost.de, local port 3210
- Verification: Let’s Encrypt valid; GitHub Actions CI/deploy passed; guest workout/set persistence and recovery tested in production Chromium; EN/DE switch and permanent guest warning verified; eight licensed machine photos and German exercise copy verified in the production database; Google Identity button and server client configuration verified
- Production revision: `e1773c2`
