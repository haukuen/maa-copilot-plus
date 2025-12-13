import { GM_getValue, GM_setValue } from '$';

interface Operator {
  name: string;
  elite: number;
  level: number;
  rarity: number;
  maxSkill: number;
  own?: boolean;
}

// 作业中的干员定义
interface CopilotOper {
  name: string;
  skill?: number;
  skill_usage?: number;
  skill_times?: number;
}

// 干员集合（如"奶盾"）
interface CopilotGroup {
  name: string;
  opers: CopilotOper[];
}

// 作业内容结构
interface CopilotContent {
  minimum_required?: string;
  stage_name?: string;
  doc?: { title?: string; details?: string };
  opers?: CopilotOper[];
  groups?: CopilotGroup[];
  difficulty?: number;
}

// API 响应中的作业项
interface CopilotItem {
  id: number;
  content: string;
  uploader: string;
  views: number;
  like: number;
  dislike: number;
  hot_score: number;
  // ... 其他字段
}

// API 响应结构
interface CopilotQueryResponse {
  status_code: number;
  data: {
    has_next: boolean;
    page: number;
    total: number;
    data: CopilotItem[];
  };
}

// 初始化角色列表
let myOperators: Operator[] = GM_getValue("myOperators", []);
// 筛选开关状态
let filterEnabled = GM_getValue("filterEnabled", true);
// 允许缺少一个干员
let allowOneMissing = GM_getValue("allowOneMissing", false);
// 被筛选掉的作业数量
let lastFilteredCount = 0;


const COPILOT_QUERY_URL = 'prts.maa.plus/copilot/query';

/**
 * 检查单个干员是否满足条件
 * @returns true 如果拥有该干员且技能等级足够
 */
function checkOperator(oper: CopilotOper): boolean {
  const myOp = myOperators.find(op => op.name === oper.name);
  if (!myOp) return false;

  // 六星干员必须精二
  if (myOp.rarity === 5 && myOp.elite < 2) return false;

  const requiredSkill = oper.skill || 1;
  return requiredSkill <= myOp.maxSkill;
}

/**
 * 检查干员集合是否满足条件
 * 满足其一即可
 */
function checkGroup(group: CopilotGroup): boolean {
  if (!group.opers || group.opers.length === 0) return true;
  return group.opers.some(oper => checkOperator(oper));
}

/**
 * 检查作业是否满足筛选条件
 * @returns { pass: boolean, missingCount: number }
 */
function checkCopilotItem(item: CopilotItem): { pass: boolean; missingCount: number } {
  try {
    const content: CopilotContent = JSON.parse(item.content);
    let missingCount = 0;

    // 检查直接使用的干员
    if (content.opers) {
      for (const oper of content.opers) {
        if (!checkOperator(oper)) {
          missingCount++;
        }
      }
    }

    // 检查干员集合
    if (content.groups) {
      for (const group of content.groups) {
        if (!checkGroup(group)) {
          missingCount++;
        }
      }
    }

    const pass = allowOneMissing ? missingCount <= 1 : missingCount === 0;
    return { pass, missingCount };
  } catch (e) {
    console.warn(`解析作业内容失败 (id=${item.id}):`, e);
    // 解析失败时默认通过
    return { pass: true, missingCount: 0 };
  }
}

/**
 * 筛选响应数据，移除不符合条件的作业
 */
function filterResponse(response: CopilotQueryResponse): CopilotQueryResponse {
  if (!filterEnabled || myOperators.length === 0) {
    return response;
  }

  const originalData = response.data.data;
  const filteredData = originalData.filter(item => checkCopilotItem(item).pass);

  lastFilteredCount = originalData.length - filteredData.length;

  setTimeout(() => updateStatus(lastFilteredCount), 100);

  return {
    ...response,
    data: {
      ...response.data,
      data: filteredData
    }
  };
}

/**
 * 拦截 XMLHttpRequest
 */
function interceptXHR() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    this._url = url.toString();
    this._isCopilotQuery = this._url.includes(COPILOT_QUERY_URL);
    return originalOpen.apply(this, [method, url, ...args] as any);
  };

  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
    if (this._isCopilotQuery) {
      const xhr = this;
      const originalOnReadyStateChange = xhr.onreadystatechange;

      xhr.onreadystatechange = function(ev) {
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const response: CopilotQueryResponse = JSON.parse(xhr.responseText);
            const filtered = filterResponse(response);

            // 重写 responseText
            Object.defineProperty(xhr, 'responseText', {
              get: () => JSON.stringify(filtered)
            });
            Object.defineProperty(xhr, 'response', {
              get: () => JSON.stringify(filtered)
            });
          } catch (e) {
            console.warn('拦截响应处理失败:', e);
          }
        }
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.call(xhr, ev);
        }
      };
    }
    return originalSend.call(this, body);
  };
}

/**
 * 拦截 fetch 请求
 */
function interceptFetch() {
  const originalFetch = window.fetch;

  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    const response = await originalFetch.call(this, input, init);

    if (url.includes(COPILOT_QUERY_URL)) {
      try {
        const clonedResponse = response.clone();
        const json: CopilotQueryResponse = await clonedResponse.json();
        const filtered = filterResponse(json);

        return new Response(JSON.stringify(filtered), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (e) {
        console.warn('拦截 fetch 响应失败:', e);
      }
    }

    return response;
  };
}

interceptXHR();
interceptFetch();

// 扩展 XMLHttpRequest 类型
declare global {
  interface XMLHttpRequest {
    _url?: string;
    _isCopilotQuery?: boolean;
  }
}

function safeQuerySelector(selector: string, parent: Element | Document = document): HTMLElement | null {
  try {
    return parent.querySelector(selector) as HTMLElement;
  } catch (e) {
    console.warn(`查询选择器失败: ${selector}`, e);
    return null;
  }
}

function safeQuerySelectorAll(selector: string, parent: Element | Document = document): NodeListOf<HTMLElement> {
  try {
    return parent.querySelectorAll(selector);
  } catch (e) {
    console.warn(`查询选择器失败: ${selector}`, e);
    return document.querySelectorAll('nothing');
  }
}

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
    cursor: "move"
  });

  let isDragging = false;
  let initialX = 0;
  let initialY = 0;

  controlPanel.addEventListener("mousedown", (e) => {
    isDragging = true;
    initialX = e.clientX - controlPanel.offsetLeft;
    initialY = e.clientY - controlPanel.offsetTop;
    controlPanel.style.opacity = "0.8";
    controlPanel.style.transition = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      e.preventDefault();
      let currentX = e.clientX - initialX;
      let currentY = e.clientY - initialY;

      const maxX = window.innerWidth - controlPanel.offsetWidth;
      const maxY = window.innerHeight - controlPanel.offsetHeight;

      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      controlPanel.style.left = currentX + "px";
      controlPanel.style.top = currentY + "px";
      controlPanel.style.right = "auto";
    }
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

  const savedPosition = GM_getValue<{ left: string; top: string } | null>("panelPosition", null);
  if (savedPosition) {
    controlPanel.style.left = savedPosition.left;
    controlPanel.style.top = savedPosition.top;
    controlPanel.style.right = "auto";
  }

  const title = document.createElement("h3");
  title.textContent = "MAA Copilot Plus";
  title.style.margin = "0 0 10px 0";
  title.style.cursor = "move";

  const buttonContainer = document.createElement("div");
  buttonContainer.style.display = "flex";
  buttonContainer.style.marginBottom = "10px";

  const importButton = document.createElement("button");
  importButton.textContent = "导入角色列表";
  importButton.onclick = openImportDialog;
  buttonContainer.appendChild(importButton);

  const toggleContainer = document.createElement("div");
  Object.assign(toggleContainer.style, { display: "flex", alignItems: "center", marginBottom: "10px" });

  const toggleLabel = document.createElement("label");
  Object.assign(toggleLabel.style, { display: "flex", alignItems: "center", cursor: "pointer" });

  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = filterEnabled;
  toggleInput.style.margin = "0 5px 0 0";
  toggleInput.onchange = function () {
    filterEnabled = toggleInput.checked;
    GM_setValue("filterEnabled", filterEnabled);
    updateStatus();
    if (confirm("筛选设置已更改，需要刷新页面才能生效。是否立即刷新？")) {
      location.reload();
    }
  };

  const toggleText = document.createElement("span");
  toggleText.textContent = "启用筛选";
  toggleLabel.append(toggleInput, toggleText);
  toggleContainer.appendChild(toggleLabel);

  // 缺少干员设置
  const missingContainer = document.createElement("div");
  Object.assign(missingContainer.style, { display: "flex", alignItems: "center", marginBottom: "10px" });

  const missingLabel = document.createElement("label");
  Object.assign(missingLabel.style, { display: "flex", alignItems: "center", cursor: "pointer" });

  const missingInput = document.createElement("input");
  missingInput.type = "checkbox";
  missingInput.checked = allowOneMissing;
  missingInput.style.margin = "0 5px 0 0";
  missingInput.onchange = function () {
    allowOneMissing = missingInput.checked;
    GM_setValue("allowOneMissing", allowOneMissing);
    if (confirm("筛选设置已更改，需要刷新页面才能生效。是否立即刷新？")) {
      location.reload();
    }
  };

  const missingText = document.createElement("span");
  missingText.textContent = "允许缺少一个干员";
  missingLabel.append(missingInput, missingText);
  missingContainer.appendChild(missingLabel);

  const status = document.createElement("div");
  status.id = "maa-status";
  status.style.fontSize = "12px";

  controlPanel.append(title, buttonContainer, toggleContainer, missingContainer, status);
  document.body.appendChild(controlPanel);

  updateStatus();
}

function updateStatus(filteredCount?: number) {
  try {
    const status = document.getElementById("maa-status");
    if (status) {
      let statusText = `已导入 ${myOperators.length} 个角色`;
      if (filterEnabled) {
        statusText += filteredCount !== undefined
          ? `, 筛选掉 ${filteredCount} 个不符合条件的攻略`
          : " (筛选已启用)";
      } else {
        statusText += " (筛选已禁用)";
      }
      status.textContent = statusText;
      status.style.color = filterEnabled ? "green" : "gray";
    }
  } catch (e) {
    console.warn("更新状态显示失败:", e);
  }
}

function openImportDialog() {
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center",
    alignItems: "center", zIndex: "10000"
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    backgroundColor: "white", padding: "20px", borderRadius: "5px",
    width: "80%", maxWidth: "600px", maxHeight: "80%", overflow: "auto"
  });

  const title = document.createElement("h3");
  title.textContent = "导入角色列表";
  title.style.marginTop = "0";

  const textarea = document.createElement("textarea");
  Object.assign(textarea.style, { width: "100%", height: "200px", marginBottom: "10px" });
  textarea.placeholder = "粘贴角色列表 JSON 数据...";

  const buttonContainer = document.createElement("div");
  Object.assign(buttonContainer.style, { display: "flex", justifyContent: "flex-end" });

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "取消";
  cancelButton.style.marginRight = "10px";
  cancelButton.onclick = () => document.body.removeChild(modal);

  const importBtn = document.createElement("button");
  importBtn.textContent = "导入";
  importBtn.onclick = () => {
    try {
      const data = JSON.parse(textarea.value);
      if (Array.isArray(data)) {
        myOperators = data
          .filter((op: any) => op.own)
          .map((op: any) => ({
            name: op.name,
            elite: op.elite,
            level: op.level,
            rarity: op.rarity,
            maxSkill: op.elite === 0 ? 1 : op.elite === 1 ? 2 : 3
          }));
        GM_setValue("myOperators", myOperators);
        updateStatus();
        document.body.removeChild(modal);
        if (confirm("角色列表已导入，需要刷新页面才能生效。是否立即刷新？")) {
          location.reload();
        }
      } else {
        alert("无效的数据格式");
      }
    } catch (e: any) {
      alert("解析失败: " + e.message);
    }
  };

  buttonContainer.append(cancelButton, importBtn);
  dialog.append(title, textarea, buttonContainer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

let lastUrl = location.href;

const observer = new MutationObserver(() => {
  try {
    if (lastUrl !== location.href) {
      lastUrl = location.href;
    }
    removeAds();
  } catch (e) {
    console.error("Observer错误:", e);
  }
});

const removeAds = () => {
  const sideAd = safeQuerySelector("body > main > div > div:nth-child(2) > div > div:nth-child(2) > div > a");
  if (sideAd) sideAd.style.display = "none";

  const adSelectors = [
    'a[href*="gad.netease.com"]',
    'a[href*="ldmnq.com"]',
    'a[href*="ldy/ldymuban"]',
    'a[class*="block relative"]'
  ];
  adSelectors.forEach(selector => {
    safeQuerySelectorAll(selector).forEach(ad => ad.style.display = "none");
  });
};

observer.observe(document.body, {
  childList: true,
  subtree: true
});

createUI();
removeAds();