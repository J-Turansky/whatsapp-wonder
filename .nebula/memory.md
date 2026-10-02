# WhatsApp Wonder — project memory

Idea: A simple web app which i can manually import whatsapp chat logs into and the web app will produce facts, statistics, jokes, summaries from the chat.

- Decisions wave 1: 100% in-browser processing, no uploads, no AI/network, no libraries (charts in CSS/SVG). Import accepts .txt (unzipped) or pasted text; .zip deferred. Parser must handle Android "dd/mm/yy, hh:mm - Name: msg" and iOS "[dd/mm/yy, hh:mm:ss] Name: msg", 12/24h, multiline, system lines, <Media omitted>. Jokes/summaries are template-based. Refs: whatsanalyze.com, chatanalyzer.io, github.com/Pustur/whatsapp-chat-parser. (Nova, 2026-10-02)
- Shell (#1) uses v1.0.0 to match the backlog label. #2 should mount its UI into #app-main. Files: index.html, css/styles.css, js/version.js, js/app.js (ES modules). (Nova, 2026-10-02)
- 2026-10-02: The GitHub repo j-turansky/whatsapp-wonder didn't exist, so the live URL returned 404 after #1 passed. The Conductor needs to create the repo and enable Pages because agents can't touch remotes. Feature #1 passed but isn't live yet. (Nova, 2026-10-02)
- 2026-10-02: UPDATE from the Conductor: the crew may now create GitHub repos (create_repo tool). This replaces the earlier note that the Conductor must create the repo. Feature #1 passed testing, so it ships on resume. (Conductor, 2026-10-02)
