# FIT application delivery state

- Domain: `fit.kir-it.de`
- TaskFlow: `40b43181-3a83-47a1-a28a-6ef0ec1d9e7a`
- Requested: 2026-08-24, Telegram topic 162
- Status: completed and verified
- Repository: `KirDE/kir-fit`, branch `main`
- Production: `https://fit.kir-it.de`, Docker stack healthy on nc.lighthost.de, local port 3210
- Verification: Let’s Encrypt valid; GitHub Actions CI/deploy passed; production mobile workflow, recovery, history and progress passed; temporary test data removed
- Production revision: `359fad5`
