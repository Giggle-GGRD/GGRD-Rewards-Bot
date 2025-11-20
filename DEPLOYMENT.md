# 🚀 Deployment na Render.com

## Czym jest Render.com?

Render to platforma do hostowania aplikacji z darmowym tierem. Świetnie nadaje się do botów Telegram działających 24/7.

## ⚡ Szybki Start

### 1. Utwórz konto na Render

1. Idź na: https://render.com/
2. Kliknij "Get Started for Free"
3. Zarejestruj się (możesz użyć GitHub)

### 2. Połącz GitHub z Render

1. W dashboard Render kliknij "New +"
2. Wybierz "Background Worker"
3. Połącz z GitHubem (Connect account)
4. Wybierz repozytorium: `GGRD-Rewards-Bot`

### 3. Konfiguracja deploymentu

**Name**: `ggrd-rewards-bot`

**Region**: Frankfurt (lub najbliższy)

**Branch**: `master`

**Build Command**: `npm install`

**Start Command**: `node index.js`

### 4. Dodaj zmienne środowiskowe

W sekcji "Environment Variables" dodaj:

```
BOT_TOKEN = <twój_token_z_botfather>
CHANNEL_ID = @GGRDofficial
GROUP_ID = @GGRDchat
```

**WAŻNE**: `BOT_TOKEN` musi być ustawiony jako **Secret** (kliknij "Add Secret File")

### 5. Deploy!

Kliknij "Create Background Worker" - Render automatycznie:
- Sklonuje repozytorium
- Zainstaluje zależności (`npm install`)
- Uruchomi bota (`node index.js`)

## 📊 Monitorowanie

W dashboard Render zobaczysz:
- 📈 Logi w czasie rzeczywistym
- 🔄 Status deploymentu
- 💾 Zużycie zasobów

## 🆓 Darmowy Plan (Free Tier)

**Zalety:**
- ✅ 750 godzin darmowych miesięcznie
- ✅ Automatyczne restarty przy błędach
- ✅ HTTPS i SSL za darmo
- ✅ Automatyczne deploymenty z GitHub

**Ograniczenia:**
- ⚠️ Background Worker może być zatrzymany po długim okresie nieaktywności
- ⚠️ 512 MB RAM
- ⚠️ Współdzielony CPU

**Dla bota Telegram**: Darmowy plan jest w zupełności wystarczający!

## 🔄 Automatyczne Deploymenty

Render automatycznie zrobi redeploy gdy:
- Wypuszczysz zmiany do brancha `master`
- Ręcznie klikniesz "Manual Deploy"

## 🐛 Troubleshooting

**Bot nie startuje:**
```bash
# W Render Logs sprawdź:
- Czy BOT_TOKEN jest ustawiony
- Czy wszystkie zależności się zainstalowały
- Czy nie ma błędów w kodzie
```

**"Cannot find module":**
```bash
# Upewnij się że build command to:
npm install
# A nie: npm ci
```

**Bot się restartuje:**
- To normalne - Render restartuje przy błędach
- Sprawdź logi by zobaczyć przyczynę

## 📝 Komendy Render CLI (opcjonalnie)

Zainstaluj Render CLI:
```bash
npm install -g @render/cli
```

Użycie:
```bash
# Zaloguj się
render login

# Zobacz logi
render logs ggrd-rewards-bot

# Restart
render restart ggrd-rewards-bot
```

## 🔗 Przydatne Linki

- Dashboard: https://dashboard.render.com/
- Dokumentacja: https://render.com/docs
- Status: https://status.render.com/

## 💡 Pro Tips

1. **Dodaj health monitoring**: W kodzie możesz dodać endpoint do sprawdzania czy bot działa
2. **Sprawdzaj logi**: Dashboard → Logs → Real-time logs
3. **Backup bazy danych**: Regularnie exportuj `ggrd_members.json` komendą `/export`
4. **Notifications**: Ustaw email alerts w Render dla błędów deploymentu

## 🎯 Po Deploymencie

1. Sprawdź logi - powinien pojawić się komunikat:
   ```
   🤖 GGRD Community Rewards Bot started successfully!
   ```

2. Przetestuj bota w Telegramie:
   - Wyślij `/start`
   - Kliknij "Verify my tasks"
   - Wyślij adres portfela

3. Monitoruj przez kilka minut czy nie ma restartów

---

✅ **Bot działa 24/7 na Render!** 🚀
