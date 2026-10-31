import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import ini from "highlight.js/lib/languages/ini";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("go", go);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("ini", ini);

export interface HighlightRequest {
  id: number;
  language: string;
  /** 已去掉 diff 前缀的纯代码行 */
  lines: string[];
}

export interface HighlightResponse {
  id: number;
  /** 与请求行一一对应；无法高亮的行返回 null */
  html: (string | null)[];
}

self.onmessage = (e: MessageEvent<HighlightRequest>) => {
  const { id, language, lines } = e.data;
  const html = lines.map((line) => {
    if (!line.trim()) return null;
    try {
      return hljs.highlight(line, { language }).value;
    } catch {
      return null;
    }
  });
  const response: HighlightResponse = { id, html };
  self.postMessage(response);
};
