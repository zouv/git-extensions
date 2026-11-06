// 浮层栈：只有最上层处理 Escape / Tab，避免嵌套弹窗一起关闭或焦点互相争抢。
const stack: symbol[] = [];

export function pushLayer(): symbol {
  const token = Symbol("ui-layer");
  stack.push(token);
  return token;
}

export function popLayer(token: symbol) {
  const index = stack.lastIndexOf(token);
  if (index >= 0) stack.splice(index, 1);
}

export function isTopLayer(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}
