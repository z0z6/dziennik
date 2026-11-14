# Dziennik WTZ

Aplikacja dla psychologa w Warsztacie Terapii Zajęciowej. Służy do prowadzenia „Dziennika psychologa” w jednolitym, stałym formacie, a pomaga jej w tym agent AI (Claude).

## Co potrafi

- **Lista obecności ze zdjęcia.** Wysyłasz zdjęcie podpisanej listy (może mieć kilka stron), a Claude odczytuje dni, godziny i oznaczenia (U, L4…). Agent porównuje wynik z kalendarzem świąt i Twoim harmonogramem, a niepewne odczyty oznacza do sprawdzenia.
- **3 propozycje tematu na każdy dzień.** Każda propozycja to pełny plan dnia (3–4 punkty, domyślnie w formacie „12:00–12:45 | …”). Agent bierze pod uwagę święta i dni okolicznościowe związane z WTZ, niepełnosprawnością i pomocą społeczną. Szuka też w internecie aktualnych wydarzeń i nie powtarza tematów, które już zrealizowałeś.
- **Dokument .docx w Twoim formacie.** Pierwsza tabela Twojego dziennika służy za wzór, więc czcionka (Calibri), rozmiary, punktory i szerokości kolumn zostają 1:1. Masz dwa tryby:
  - *Dopisz do mojego dziennika*: nowe wiersze trafiają do istniejącego pliku w kolejności dat. Przed nadpisaniem powstaje kopia zapasowa.
  - *Nowy dokument z wzoru*.
- **Agent w tle.** Pilnuje świąt ustawowych (z Wigilią od 2025 r.) i świąt przypadających w sobotę. Zna Twoje dni wolne i okresy przerwy, przypomina o liście obecności i o brakach w dzienniku. Pokazuje też powiadomienia systemowe i działa z zasobnika systemowego.
- **Import historii** z dotychczasowego dziennika .docx. Dzięki niemu AI zna zrealizowane tematy i pisze w Twoim stylu.
- Interfejs w stylu macOS/iOS z trybem jasnym i ciemnym.

## Połączenie z Claude

Anthropic nie pozwala zewnętrznym aplikacjom logować się kontem Claude.ai. Aplikacja oferuje więc dwa dozwolone sposoby:

1. **Moje konto Claude (zalecane przy planie Pro/Max).** Zainstaluj [Claude Code](https://claude.com/product/claude-code), uruchom w terminalu `claude` i zaloguj się swoim kontem. Aplikacja wywołuje oficjalny program w trybie `claude -p`, więc zużycie liczy się z Twojego planu.
2. **Klucz API** z [platform.claude.com](https://platform.claude.com/settings/keys). Rozliczasz się osobno, za faktyczne zużycie. Klucz jest zapisany w zaszyfrowanej postaci.

Sposób połączenia wybierasz w *Ustawienia → Claude*, gdzie jest też przycisk „Testuj połączenie”.

## Pobieranie

Każdy push na `main` buduje aplikację w GitHub Actions (zakładka **Actions → Build → Artifacts**):

- `Dziennik-WTZ-…-linux-x86_64.AppImage`: Linux. Nadaj prawo wykonywania (`chmod +x`) i uruchom. Na niektórych dystrybucjach trzeba doinstalować `libfuse2`.
- `Dziennik-WTZ-…-portable.exe`: Windows w wersji przenośnej. Dane zapisują się w folderze „Dziennik WTZ - dane” obok pliku .exe.

Tag `v*` (np. `git tag v1.0.0 && git push --tags`) dodatkowo tworzy wydanie (Release) z oboma plikami.

## Rozwój

```bash
npm install
npm start          # uruchomienie
npm test           # testy logiki (święta, lista obecności, generowanie .docx)
npm run dist:linux # AppImage
npm run dist:win   # portable .exe (na Windows)
```

Struktura:

- `src/main/`: proces główny (kalendarz i święta, magazyn danych, agent, generowanie .docx z wzoru, integracja z Claude)
- `src/renderer/`: interfejs
- `src/assets/wzor-dziennika.docx`: wbudowany wzór dziennika
