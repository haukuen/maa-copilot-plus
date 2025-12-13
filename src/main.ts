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
  ...args: any[]
) {
  (this as any)._url = url.toString();
  (this as any)._isCopilotQuery = (this as any)._url.includes(
    COPILOT_QUERY_URL
  );
  return _originalXHROpen.apply(this, [method, url, ...args] as any);
};

pageWindow.XMLHttpRequest.prototype.send = function (
  body?: Document | XMLHttpRequestBodyInit | null
) {
  if ((this as any)._isCopilotQuery) {
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

// ============ 状态 ============

let myOperators: Operator[] = GM_getValue("myOperators", []);
let filterEnabled = GM_getValue("filterEnabled", true);
let allowOneMissing = GM_getValue("allowOneMissing", false);
let lastFilteredCount = 0;

// ============ 筛选逻辑 ============

function checkOperator(oper: CopilotOper): boolean {
  const myOp = myOperators.find((op) => op.name === oper.name);
  if (!myOp) return false;
  if (myOp.rarity === 6 && myOp.elite < 2) return false; // 六星必须精二
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
    let missingCount = 0;

    content.opers?.forEach((oper) => {
      if (!checkOperator(oper)) missingCount++;
    });
    content.groups?.forEach((group) => {
      if (!checkGroup(group)) missingCount++;
    });

    return {
      pass: allowOneMissing ? missingCount <= 1 : missingCount === 0,
      missingCount,
    };
  } catch {
    return { pass: true, missingCount: 0 };
  }
}

function filterResponse(response: CopilotQueryResponse): CopilotQueryResponse {
  if (!filterEnabled || !myOperators.length) return response;

  const originalData = response.data.data;
  const filteredData = originalData.filter(
    (item) => checkCopilotItem(item).pass
  );
  lastFilteredCount = originalData.length - filteredData.length;

  setTimeout(() => updateStatus(lastFilteredCount), 100);

  return { ...response, data: { ...response.data, data: filteredData } };
}

declare global {
  interface XMLHttpRequest {
    _url?: string;
    _isCopilotQuery?: boolean;
  }
}

// ============ UI ============

function createUI() {
  const controlPanel = document.createElement("div");
  controlPanel.id = "maa-copilot-plus";
  Object.assign(controlPanel.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    zIndex: "9999",
    backgroundColor: "#f0f0f0",
    padding: "10px",
    borderRadius: "5px",
    boxShadow: "0 0 10px rgba(0,0,0,0.2)",
    cursor: "move",
  });

  // 拖拽
  let isDragging = false,
    initialX = 0,
    initialY = 0;

  controlPanel.addEventListener("mousedown", (e) => {
    isDragging = true;
    initialX = e.clientX - controlPanel.offsetLeft;
    initialY = e.clientY - controlPanel.offsetTop;
    controlPanel.style.opacity = "0.8";
    controlPanel.style.transition = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const maxX = window.innerWidth - controlPanel.offsetWidth;
    const maxY = window.innerHeight - controlPanel.offsetHeight;
    controlPanel.style.left =
      Math.max(0, Math.min(e.clientX - initialX, maxX)) + "px";
    controlPanel.style.top =
      Math.max(0, Math.min(e.clientY - initialY, maxY)) + "px";
    controlPanel.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      controlPanel.style.opacity = "1";
      controlPanel.style.transition = "opacity 0.2s";
    }
  });

  window.addEventListener("beforeunload", () => {
    if (controlPanel.style.left) {
      GM_setValue("panelPosition", {
        left: controlPanel.style.left,
        top: controlPanel.style.top,
      });
    }
  });

  const savedPosition = GM_getValue<{ left: string; top: string } | null>(
    "panelPosition",
    null
  );
  if (savedPosition) {
    controlPanel.style.left = savedPosition.left;
    controlPanel.style.top = savedPosition.top;
    controlPanel.style.right = "auto";
  }

  // 标题
  const title = document.createElement("h3");
  title.textContent = "MAA Copilot Plus";
  Object.assign(title.style, { margin: "0 0 10px 0", cursor: "move" });

  // 导入按钮
  const buttonContainer = document.createElement("div");
  buttonContainer.style.marginBottom = "10px";
  const importButton = document.createElement("button");
  importButton.textContent = "导入角色列表";
  importButton.onclick = openImportDialog;
  buttonContainer.appendChild(importButton);

  // 筛选开关
  const toggleContainer = document.createElement("div");
  Object.assign(toggleContainer.style, {
    display: "flex",
    alignItems: "center",
    marginBottom: "10px",
  });
  const toggleLabel = document.createElement("label");
  Object.assign(toggleLabel.style, {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  });
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = filterEnabled;
  toggleInput.style.margin = "0 5px 0 0";
  toggleInput.onchange = () => {
    filterEnabled = toggleInput.checked;
    GM_setValue("filterEnabled", filterEnabled);
    updateStatus();
    if (confirm("筛选设置已更改，需要刷新页面才能生效。是否立即刷新？"))
      location.reload();
  };
  const toggleText = document.createElement("span");
  toggleText.textContent = "启用筛选";
  toggleLabel.append(toggleInput, toggleText);
  toggleContainer.appendChild(toggleLabel);

  // 允许缺少一个干员
  const missingContainer = document.createElement("div");
  Object.assign(missingContainer.style, {
    display: "flex",
    alignItems: "center",
    marginBottom: "10px",
  });
  const missingLabel = document.createElement("label");
  Object.assign(missingLabel.style, {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  });
  const missingInput = document.createElement("input");
  missingInput.type = "checkbox";
  missingInput.checked = allowOneMissing;
  missingInput.style.margin = "0 5px 0 0";
  missingInput.onchange = () => {
    allowOneMissing = missingInput.checked;
    GM_setValue("allowOneMissing", allowOneMissing);
    if (confirm("筛选设置已更改，需要刷新页面才能生效。是否立即刷新？"))
      location.reload();
  };
  const missingText = document.createElement("span");
  missingText.textContent = "允许缺少一个干员";
  missingLabel.append(missingInput, missingText);
  missingContainer.appendChild(missingLabel);

  // 状态
  const status = document.createElement("div");
  status.id = "maa-status";
  status.style.fontSize = "12px";

  controlPanel.append(
    title,
    buttonContainer,
    toggleContainer,
    missingContainer,
    status
  );
  document.body.appendChild(controlPanel);
  updateStatus();
}

function updateStatus(filteredCount?: number) {
  const status = document.getElementById("maa-status");
  if (!status) return;

  let text = `已导入 ${myOperators.length} 个角色`;
  if (filterEnabled) {
    text +=
      filteredCount !== undefined
        ? `，筛选掉 ${filteredCount} 个`
        : " (筛选已启用)";
  } else {
    text += " (筛选已禁用)";
  }
  status.textContent = text;
  status.style.color = filterEnabled ? "green" : "gray";
}

function openImportDialog() {
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
    zIndex: "10000",
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    backgroundColor: "white",
    padding: "20px",
    borderRadius: "5px",
    width: "80%",
    maxWidth: "600px",
    maxHeight: "80%",
    overflow: "auto",
  });

  const title = document.createElement("h3");
  title.textContent = "导入角色列表";
  title.style.marginTop = "0";

  const textarea = document.createElement("textarea");
  Object.assign(textarea.style, {
    width: "100%",
    height: "200px",
    marginBottom: "10px",
  });
  textarea.placeholder = "粘贴角色列表 JSON 数据...";

  const buttonContainer = document.createElement("div");
  Object.assign(buttonContainer.style, {
    display: "flex",
    justifyContent: "flex-end",
  });

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "取消";
  cancelButton.style.marginRight = "10px";
  cancelButton.onclick = () => document.body.removeChild(modal);

  const importBtn = document.createElement("button");
  importBtn.textContent = "导入";
  importBtn.onclick = () => {
    try {
      const data = JSON.parse(textarea.value);
      if (!Array.isArray(data)) {
        alert("无效的数据格式");
        return;
      }

      myOperators = data
        .filter((op: any) => op.own)
        .map((op: any) => ({
          name: op.name,
          elite: op.elite,
          level: op.level,
          rarity: op.rarity,
          maxSkill: op.elite === 0 ? 1 : op.elite === 1 ? 2 : 3,
        }));
      GM_setValue("myOperators", myOperators);
      updateStatus();
      document.body.removeChild(modal);
      if (confirm("角色列表已导入，需要刷新页面才能生效。是否立即刷新？"))
        location.reload();
    } catch (e: any) {
      alert("解析失败: " + e.message);
    }
  };

  buttonContainer.append(cancelButton, importBtn);
  dialog.append(title, textarea, buttonContainer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

// ============ 初始化 ============

function initUI() {
  if (document.body) {
    createUI();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      createUI();
    });
  }
}

initUI();
