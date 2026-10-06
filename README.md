# TranslatePlace

Soukromé rozšíření pro GNOME Shell 50. Zkratka **Super+Shift+E** vezme právě označený text, uloží originál do historie, přeloží ho přes místní `translation-api.service` a vloží překlad na místo výběru. Výchozí směr je čeština → angličtina. Ikona v horní liště ukazuje poslední překlady a otevírá nastavení. V nastavení lze změnit směr, vypnout automatické vložení a nastavit délku historie (1–200, výchozí 50).

## Předpoklady

Rozšíření předpokládá API pouze na `http://127.0.0.1:5001`. Služba běží v soukromé konfiguraci nixon a používá Ollamu; zdrojový kód serveru není součástí tohoto projektu. Potřebné rozhraní:

- `POST /translate` s JSON `{ "q": "text", "source": "cs", "target": "en" }` vrací HTTP 202 a `{ "jobId": "32 hex znaků", "status": "pending" }`.
- `GET /translations/<jobId>` vrací `status: pending`, `done` s `translatedText`, nebo `failed` s `error`.
- Maximální vstup je 10 000 znaků. Lokální server má být dostupný pouze na loopbacku.

Před instalací ověřte API příkazem `curl http://127.0.0.1:5001/health`.

## Sestavení a instalace

Spusťte `bash build.sh`; vytvoří `dist/translateplace@tomasmark79.shell-extension.zip`. Instalace do uživatelského profilu: `gnome-extensions install --force dist/translateplace@tomasmark79.shell-extension.zip`.

GNOME Shell musí nové rozšíření načíst (na Waylandu zpravidla po novém přihlášení); pak ho lze zapnout přes `gnome-extensions enable translateplace@tomasmark79`.

## Bezpečnost textu

Před požadavkem na API se originál zapisuje do `~/.local/state/translateplace/history.json` (oprávnění 0600). Při chybě zůstává uložen. Historie obsahuje soukromý obsah označeného textu, takže tento soubor nezálohujte ani nesdílejte bez rozmyslu.

URL, emoji, bloky kódu, HTML značky a celé Markdown odkazy či zvýrazněné úseky se při překladu maskují. Model ale může maskované části vypustit nebo přesunout. Překlad se i v takovém případě vloží a historie upozorní, které části chybí či se změnily; originál zůstane uložený. Formátování uložené *mimo text* (například styly ve WYSIWYG editoru) se běžným vložením jako prostý text nemusí zachovat.

Načtení a vložení probíhá pomocí běžných kláves `Ctrl+C` a `Ctrl+V` uvnitř GNOME Shell. Funguje v editovatelných polích, která tyto zkratky podporují a ponechávají výběr; v terminálech nebo zvláštních editorech může být nutné překlad z historie zkopírovat ručně. Rozšíření vloží překlad jen tehdy, pokud je stále aktivní stejné okno a schránka od načtení výběru zůstala stejná. Po úspěšném vložení je překlad ve schránce.

Projekt se zatím nezveřejňuje.
