import { GM_getValue, GM_setValue, unsafeWindow } from "$";

// 必须最早拦截
const COPILOT_QUERY_URL = "prts.maa.plus/copilot/query";

const pageWindow = unsafeWindow || window;
const _originalFetch = pageWindow.fetch.bind(pageWindow);
const _originalXHROpen = pageWindow.XMLHttpRequest.prototype.open;
const _originalXHRSend = pageWindow.XMLHttpRequest.prototype.send;

pageWindow.fetch = async function (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
  const response = await _originalFetch(input, init);

  if (url.includes(COPILOT_QUERY_URL)) {
    try {
      const json = await response.clone().json();
      return new Response(JSON.stringify(filterResponse(json)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (e) {
      console.warn("拦截 fetch 失败:", e);
    }
  }
  return response;
};

pageWindow.XMLHttpRequest.prototype.open = function (
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null
) {
  this._url = url.toString();
  this._isCopilotQuery = this._url.includes(COPILOT_QUERY_URL);
  return _originalXHROpen.call(this, method, url, async ?? true, username, password);
};

pageWindow.XMLHttpRequest.prototype.send = function (
  body?: Document | XMLHttpRequestBodyInit | null
) {
  if (this._isCopilotQuery) {
    const xhr = this;
    const originalOnReadyStateChange = xhr.onreadystatechange;

    xhr.onreadystatechange = function (ev) {
      if (xhr.readyState === 4 && xhr.status === 200) {
        try {
          const filtered = filterResponse(JSON.parse(xhr.responseText));
          Object.defineProperty(xhr, "responseText", {
            get: () => JSON.stringify(filtered),
          });
          Object.defineProperty(xhr, "response", {
            get: () => JSON.stringify(filtered),
          });
        } catch (e) {
          console.warn("拦截 XHR 失败:", e);
        }
      }
      originalOnReadyStateChange?.call(xhr, ev);
    };
  }
  return _originalXHRSend.call(this, body);
};

// ============ 类型定义 ============

interface Operator {
  name: string;
  elite: number;
  level: number;
  rarity: number;
  maxSkill: number;
  own?: boolean;
}

interface CopilotOper {
  name: string;
  skill?: number;
  skill_usage?: number;
  skill_times?: number;
}

interface CopilotGroup {
  name: string;
  opers: CopilotOper[];
}

interface CopilotContent {
  minimum_required?: string;
  stage_name?: string;
  doc?: { title?: string; details?: string };
  opers?: CopilotOper[];
  groups?: CopilotGroup[];
  difficulty?: number;
}

interface CopilotItem {
  id: number;
  content: string;
  uploader: string;
  views: number;
  like: number;
  dislike: number;
  hot_score: number;
}

interface CopilotQueryResponse {
  status_code: number;
  data: {
    has_next: boolean;
    page: number;
    total: number;
    data: CopilotItem[];
  };
}

// 原始干员数据类型（导入时使用）
interface RawOperator {
  name: string;
  elite: number;
  level: number;
  rarity: number;
  own?: boolean;
}

// ============ 状态 ============

let myOperators: Operator[] = GM_getValue("myOperators", []);
let filterEnabled = GM_getValue("filterEnabled", true);
let allowOneMissing = GM_getValue("allowOneMissing", false);
let requireSixStarElite2 = GM_getValue("requireSixStarElite2", true); // 六星必须精二才算拥有

let operatorMap: Map<string, Operator> = new Map(
  myOperators.map((op) => [op.name, op])
);

// ============ 筛选逻辑 ============

function checkOperator(oper: CopilotOper): boolean {
  const myOp = operatorMap.get(oper.name);
  if (!myOp) return false;
  if (requireSixStarElite2 && myOp.rarity === 6 && myOp.elite < 2) return false;
  return (oper.skill || 1) <= myOp.maxSkill;
}

function checkGroup(group: CopilotGroup): boolean {
  if (!group.opers?.length) return true;
  return group.opers.some((oper) => checkOperator(oper));
}

function checkCopilotItem(item: CopilotItem): {
  pass: boolean;
  missingCount: number;
} {
  try {
    const content: CopilotContent = JSON.parse(item.content);
    
    const missingOpers = content.opers?.filter((oper) => !checkOperator(oper)).length ?? 0;
    const missingGroups = content.groups?.filter((group) => !checkGroup(group)).length ?? 0;
    const missingCount = missingOpers + missingGroups;

    return {
      pass: allowOneMissing ? missingCount <= 1 : missingCount === 0,
      missingCount,
    };
  } catch (e: unknown) {
    console.warn("解析作业内容失败:", e);
    return { pass: true, missingCount: 0 };
  }
}

function filterResponse(response: CopilotQueryResponse): CopilotQueryResponse {
  if (!filterEnabled || !myOperators.length) return response;

  const originalData = response.data.data;
  const filteredData = originalData.filter(
    (item) => checkCopilotItem(item).pass
  );
  updateNavStatus();

  return { ...response, data: { ...response.data, data: filteredData } };
}

declare global {
  interface XMLHttpRequest {
    _url?: string;
    _isCopilotQuery?: boolean;
  }
}

// ============ UI ============

function showToast(
  message: string,
  options?: {
    duration?: number;
    showReloadButton?: boolean;
  }
): void {
  const { duration = 3000, showReloadButton = false } = options || {};

  const existingToast = document.getElementById("maa-toast");
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.id = "maa-toast";
  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: document.documentElement.classList.contains("dark")
      ? "#394b59"
      : "#fff",
    color: document.documentElement.classList.contains("dark") ? "#fff" : "#000",
    padding: "12px 20px",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    zIndex: "6000",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "14px",
    fontWeight: "500",
    animation: "maa-toast-in 0.3s ease",
  });

  // 添加动画样式
  if (!document.getElementById("maa-toast-style")) {
    const style = document.createElement("style");
    style.id = "maa-toast-style";
    style.textContent = `
      @keyframes maa-toast-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes maa-toast-out {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }

  const messageSpan = document.createElement("span");
  messageSpan.textContent = message;
  toast.appendChild(messageSpan);

  if (showReloadButton) {
    const reloadBtn = document.createElement("button");
    reloadBtn.className = "bp4-button bp4-small bp4-intent-primary";
    reloadBtn.textContent = "刷新页面";
    reloadBtn.onclick = () => location.reload();
    toast.appendChild(reloadBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "bp4-button bp4-small bp4-minimal";
  closeBtn.innerHTML = "✕";
  closeBtn.style.marginLeft = "4px";
  closeBtn.onclick = () => removeToast();
  toast.appendChild(closeBtn);

  document.body.appendChild(toast);

  const removeToast = () => {
    toast.style.animation = "maa-toast-out 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  };

  // 如果不显示刷新按钮，自动消失
  if (!showReloadButton && duration > 0) {
    setTimeout(removeToast, duration);
  }
}

// 提示刷新页面
function showReloadToast(message: string): void {
  showToast(message + "需要刷新页面才能生效。", { showReloadButton: true });
}

// 创建导航栏按钮
function createNavButton(
  text: string,
  isActive: boolean,
  onClick: () => void,
  title?: string
): HTMLButtonElement {
  const btn = document.createElement("button");
  // 使用这个网站原生的 bp4 样式
  btn.className = `bp4-button bp4-minimal ${isActive ? "bp4-active" : ""}`;
  btn.type = "button";

  const span = document.createElement("span");
  span.className = "bp4-button-text";
  span.textContent = text;
  btn.appendChild(span);

  btn.onclick = onClick;
  if (title) btn.title = title;

  return btn;
}

// 查找导航栏并注入控件
function injectToNavbar() {
  // 查找导航栏容器
  const navbar = document.querySelector(".bp4-navbar");
  if (!navbar) {
    // 可能是未加载完，或者是 iframe 等情况
    setTimeout(injectToNavbar, 1000);
    return;
  }

  // 查找右侧按钮区域 (Login, etc.)
  // DOM: <div class="flex md:gap-4 gap-3">
  const rightContainer = navbar.querySelector(".flex.md\\:gap-4");
  if (!rightContainer) {
    setTimeout(injectToNavbar, 1000);
    return;
  }

  // 防止重复注入
  if (document.getElementById("maa-copilot-plus")) return;

  // 创建控件容器
  const container = document.createElement("div");
  container.id = "maa-copilot-plus";
  // 使用 Tailwind 样式保持一致性 (如果网站有 loading tailwind)
  // 或者直接写 atomic css
  // DOM 中用的是 flex items-center, gap 也是 tailwind
  container.className = "flex items-center gap-2 mr-2";

  // 筛选开关按钮
  const filterBtn = createNavButton(
    filterEnabled ? "筛选中" : "筛选",
    filterEnabled,
    () => {
      filterEnabled = !filterEnabled;
      GM_setValue("filterEnabled", filterEnabled);

      // 更新按钮状态
      filterBtn.classList.toggle("bp4-active", filterEnabled);
      const textSpan = filterBtn.querySelector(".bp4-button-text");
      if (textSpan) textSpan.textContent = filterEnabled ? "筛选中" : "筛选";

      updateNavStatus();
      showReloadToast("筛选设置已更改，");
    },
    "开启/关闭自动筛选"
  );

  // 筛选设置按钮
  const settingsBtn = createNavButton(
    "筛选设置",
    false,
    openSettingsDialog,
    "打开筛选设置"
  );

  // 导入按钮
  const importBtn = createNavButton(
    "导入干员",
    false,
    openImportDialog,
    "导入干员列表"
  );

  // 状态显示
  const status = document.createElement("span");
  status.id = "maa-status";
  status.className =
    "text-sm text-zinc-600 dark:text-slate-100 ml-2 select-none";
  // 复用网站的 text color classes

  container.append(filterBtn, settingsBtn, importBtn, status);

  // 插入到右侧容器的最前面
  rightContainer.insertBefore(container, rightContainer.firstChild);

  // 更新状态
  updateNavStatus();
}

function updateNavStatus() {
  const status = document.getElementById("maa-status");
  if (!status) return;
  status.textContent = `${myOperators.length}个干员`;
}

// 创建开关组件
function createSwitch(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLLabelElement {
  const labelContainer = document.createElement("label");
  labelContainer.className = "bp4-control bp4-switch";
  Object.assign(labelContainer.style, {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    marginBottom: "12px",
  });

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => onChange(input.checked);

  const indicator = document.createElement("span");
  indicator.className = "bp4-control-indicator";

  const labelText = document.createElement("span");
  labelText.textContent = label;
  labelText.style.fontWeight = "500";

  labelContainer.append(input, indicator, labelText);

  return labelContainer;
}

// 筛选设置弹窗
function openSettingsDialog() {
  const closeModal = () => document.body.removeChild(modal);

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: "5000",
  });

  // 点击遮罩层关闭弹窗
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  const dialog = document.createElement("div");
  dialog.className = "bp4-card bp4-elevation-3";
  Object.assign(dialog.style, {
    backgroundColor: "var(--bp4-load-app-background-color, #fff)",
    minWidth: "300px",
    padding: "20px",
    borderRadius: "4px",
  });
  // 暗色模式适配
  if (document.documentElement.classList.contains("dark")) {
    dialog.style.backgroundColor = "#2f3946";
    dialog.style.color = "#fff";
  } else {
    dialog.style.backgroundColor = "#fff";
    dialog.style.color = "#000";
  }

  const title = document.createElement("h3");
  title.className = "bp4-heading";
  title.textContent = "筛选设置";
  title.style.marginTop = "0";
  title.style.marginBottom = "16px";

  // 开关容器
  const settingsContainer = document.createElement("div");
  settingsContainer.style.marginBottom = "16px";

  // 开关1: 允许缺一
  const allowMissingSwitch = createSwitch(
    "允许缺一",
    allowOneMissing,
    (checked) => {
      allowOneMissing = checked;
      GM_setValue("allowOneMissing", allowOneMissing);
    }
  );

  // 开关2: 六星必须精二
  const sixStarSwitch = createSwitch(
    "六星必须精二",
    requireSixStarElite2,
    (checked) => {
      requireSixStarElite2 = checked;
      GM_setValue("requireSixStarElite2", requireSixStarElite2);
    }
  );

  settingsContainer.append(allowMissingSwitch, sixStarSwitch);

  // 按钮容器
  const buttonContainer = document.createElement("div");
  Object.assign(buttonContainer.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
  });

  const cancelButton = document.createElement("button");
  cancelButton.className = "bp4-button";
  cancelButton.textContent = "取消";
  cancelButton.onclick = closeModal;

  const saveBtn = document.createElement("button");
  saveBtn.className = "bp4-button bp4-intent-primary";
  saveBtn.textContent = "保存";
  saveBtn.onclick = () => {
    closeModal();
    showReloadToast("筛选设置已更改，");
  };

  buttonContainer.append(cancelButton, saveBtn);
  dialog.append(title, settingsContainer, buttonContainer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

function openImportDialog() {
  const closeModal = () => document.body.removeChild(modal);
  
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: "5000",
  });
  
  // 点击遮罩层关闭弹窗
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  const dialog = document.createElement("div");
  // 模仿 bp4-card 或 dialog
  dialog.className = "bp4-card bp4-elevation-3";
  Object.assign(dialog.style, {
    backgroundColor: "var(--bp4-load-app-background-color, #fff)", // 尝试使用变量
    minWidth: "400px",
    padding: "20px",
    borderRadius: "4px",
  });
  // 如果没有变量，fallback 到 inline styles
  if (document.documentElement.classList.contains("dark")) {
    dialog.style.backgroundColor = "#2f3946";
    dialog.style.color = "#fff";
  } else {
    dialog.style.backgroundColor = "#fff";
    dialog.style.color = "#000";
  }

  const title = document.createElement("h3");
  title.className = "bp4-heading";
  title.textContent = "导入干员列表";
  title.style.marginTop = "0";

  const textarea = document.createElement("textarea");
  textarea.className = "bp4-input bp4-large";
  Object.assign(textarea.style, {
    width: "100%",
    height: "200px",
    marginBottom: "10px",
    resize: "vertical",
  });
  textarea.placeholder = "粘贴干员列表 JSON 数据...";
  textarea.value = JSON.stringify(myOperators, null, 2);

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "flex justify-end gap-2";
  Object.assign(buttonContainer.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
  });

  const cancelButton = document.createElement("button");
  cancelButton.className = "bp4-button";
  cancelButton.textContent = "取消";
  cancelButton.onclick = closeModal;

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "bp4-button bp4-intent-primary";
  confirmBtn.textContent = "导入";
  confirmBtn.onclick = () => {
    try {
      const data = JSON.parse(textarea.value);
      if (!Array.isArray(data)) {
        alert("无效的数据格式");
        return;
      }
      myOperators = data
        .filter((op: RawOperator) => op.own)
        .map((op: RawOperator): Operator => ({
          name: op.name,
          elite: op.elite,
          level: op.level,
          rarity: op.rarity,
          maxSkill: op.elite === 0 ? 1 : op.elite === 1 ? 2 : 3,
        }));
      // 更新 Map
      operatorMap = new Map(myOperators.map((op) => [op.name, op]));
      GM_setValue("myOperators", myOperators);
      updateNavStatus();
      closeModal();
      showReloadToast("干员列表已导入，");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      alert("解析失败: " + message);
    }
  };

  buttonContainer.append(cancelButton, confirmBtn);
  dialog.append(title, textarea, buttonContainer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

// ============ 初始化 ============

function initUI() {
  injectToNavbar();
  const observer = new MutationObserver(() => {
    if (!document.getElementById("maa-copilot-plus")) {
      injectToNavbar();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

initUI();
