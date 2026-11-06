import Icon from "./Icon";

/** 统一的内联错误：保留 Git 原始多行输出，可复制；用于弹窗与面板内的动作失败。 */
export default function InlineError({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div className={`inline-error${className ? ` ${className}` : ""}`} role="alert">
      <Icon name="warning" />
      <pre className="inline-error-text">{message}</pre>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(message); }}>复制</button>
    </div>
  );
}
