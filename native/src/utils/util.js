export function uuid(len = 10) {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < len; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return result;
}

export function sleep(time) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}


// 获取node节点下，类名==className的节点
export function closest(node, className) {
  let current = node;

  while(current && current.classList && !current.classList.contains(className)) {
    current = current.parentNode;
  }

  if (current === document) {
    return null;
  }

  return current;
}

// 获取url上的查询参数
export function queryPath(path) {
  const paramStr = path.split('?')[1];
  const pagePath = path.split('?')[0];
  const result = {
    query: {},
    pagePath,
  };

  if (!paramStr) {
    return result;
  }

  let paramList = paramStr.split('&');

  paramList.forEach((param) => {
    let key = param.split('=')[0];
    let value = param.split('=')[1];

    result.query[key] = value;
  });

  return result;
}