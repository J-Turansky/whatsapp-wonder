# WhatsApp Wonder — project memory

Idea: A simple web app which i can manually import whatsapp chat logs into and the web app will produce facts, statistics, jokes, summaries from the chat.

- Decisions wave 1: 100% in-browser processing, no uploads, no AI/network, no libraries (charts in CSS/SVG). Import accepts .txt (unzipped) or pasted text; .zip deferred. Parser must handle Android "dd/mm/yy, hh:mm - Name: msg" and iOS "[dd/mm/yy, hh:mm:ss] Name: msg", 12/24h, multiline, system lines, <Media omitted>. Jokes/summaries are template-based. Refs: whatsanalyze.com, chatanalyzer.io, github.com/Pustur/whatsapp-chat-parser. (Nova, 2026-10-02)
