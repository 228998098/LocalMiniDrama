/**
 * vidu-cli 适配模块
 *
 * 封装对 vidu-cli 子进程的调用。vidu-cli 是 Vidu 官方 CLI，支持 claw_pass（订阅每日配额）
 * 计费模式，而项目原有的 vidu 在线 API（ent/v2）只能按量计费。本模块通过 spawn 调用 CLI，
 * 复用项目现有的「AI 配置」机制：token 从配置的 api_key 字段读取，作为 VIDU_TOKEN 环境变量
 * 传给子进程；base_url 从配置的 base_url 字段读取，作为 VIDU_BASE_URL 传入。
 *
 * CLI 输出统一为 JSON，即使出错 exit code 仍为 0，因此必须解析 JSON 的 ok 字段判断成败。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * 默认 CLI 可执行文件名（依赖 PATH 中的 vidu-cli，npm 全局安装版）。
 * 可通过环境变量 VIDU_CLI_BIN 覆盖，便于指向绝对路径。
 */
const DEFAULT_VIDU_CLI_BIN = process.env.VIDU_CLI_BIN || 'vidu-cli';

/** CLI 子进程默认超时（毫秒）：提交/查询类命令应很快返回，给 120s 余量 */
const CLI_TIMEOUT_MS = 120000;

/**
 * 运行 vidu-cli 子进程并解析 JSON 输出。
 *
 * @param {object} config - AI 配置记录（来自 ai_service_configs 表）
 *   - api_key:    Vidu 订阅 token（必填），作为 VIDU_TOKEN 传入
 *   - base_url:   可选，作为 VIDU_BASE_URL 传入（默认 service.vidu.cn）
 * @param {string[]} args - CLI 参数数组（如 ['task','submit','--type','text2video',...]）
 * @param {object} log - 日志对象
 * @param {object} [opts] - 额外选项
 *   - timeoutMs: 子进程超时（默认 CLI_TIMEOUT_MS）
 *   - cwd:       子进程工作目录
 * @returns {Promise<{ok: boolean, data?: object, error?: string, stderr: string}>}
 */
function runViduCli(config, args, log, opts = {}) {
  return new Promise((resolve) => {
    const bin = DEFAULT_VIDU_CLI_BIN;
    const token = (config && config.api_key) ? String(config.api_key).trim() : '';
    // base_url 清洗：CLI 内部会自己拼 /credit/v1/...、/ent/v2/... 等路径前缀，
    // 故 VIDU_BASE_URL 必须是纯域名根。去掉末尾斜杠及误填的 /v1、/v2 等，
    // 避免 CLI 拼出 /v1/credit/v1/... 这类重复路径（导致 invalid URL）。
    const rawBase = (config && config.base_url) ? String(config.base_url).trim() : '';
    const baseUrl = rawBase
      .replace(/\/+$/, '')              // 去末尾斜杠
      .replace(/\/v\d+$/i, '')          // 去末尾误填的 /v1 /v2 等
      .replace(/\/+$/, '');

    if (!token) {
      resolve({ ok: false, error: 'vidu-cli 配置缺少 api_key（VIDU_TOKEN）', stderr: '' });
      return;
    }

    // 构造子进程环境：继承当前进程环境，注入 VIDU_TOKEN / VIDU_BASE_URL
    const env = { ...process.env, VIDU_TOKEN: token };
    if (baseUrl) env.VIDU_BASE_URL = baseUrl;

    const timeoutMs = opts.timeoutMs || CLI_TIMEOUT_MS;
    const tag = `vidu-cli ${args.slice(0, 2).join(' ')}`;
    log.info('[ViduCLI] 执行', { bin, args, has_token: !!token, base_url: baseUrl || '(默认)', timeout_ms: timeoutMs });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(bin, args, {
      env,
      cwd: opts.cwd || undefined,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      // spawn 本身失败（如 vidu-cli 不在 PATH）
      log.error('[ViduCLI] 启动失败', { tag, error: e.message });
      resolve({
        ok: false,
        error: `vidu-cli 启动失败：${e.message}（请确认已通过 npm install -g vidu-cli 安装，或设置 VIDU_CLI_BIN 指向可执行文件）`,
        stderr,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        log.error('[ViduCLI] 超时', { tag, timeout_ms: timeoutMs, stdout_chars: stdout.length });
        resolve({ ok: false, error: `vidu-cli 执行超时（${timeoutMs}ms）`, stderr });
        return;
      }

      const trimmed = stdout.trim();
      log.info('[ViduCLI] 完成', { tag, exit_code: code, stdout_chars: trimmed.length, stdout_preview: trimmed.slice(0, 800), stderr_tail: stderr.slice(-400) });

      // CLI 输出应为 JSON；尝试解析
      let data = null;
      if (trimmed) {
        try {
          data = JSON.parse(trimmed);
        } catch (_) {
          // 非 JSON 输出（如帮助文本），原样返回
          resolve({ ok: false, error: `vidu-cli 非 JSON 输出：${trimmed.slice(0, 300)}`, stderr, raw: trimmed });
          return;
        }
      }

      // 以 JSON 内 ok 字段为准（CLI 即使出错 exit code 仍为 0）
      if (data && data.ok === true) {
        resolve({ ok: true, data, stderr });
        return;
      }
      // 失败：优先取 JSON 内 error.message
      let errMsg = 'vidu-cli 调用失败';
      if (data) {
        if (data.error && typeof data.error === 'object') errMsg = data.error.message || data.error.type || JSON.stringify(data.error).slice(0, 300);
        else if (data.error) errMsg = String(data.error).slice(0, 300);
        else if (data.message) errMsg = String(data.message).slice(0, 300);
      }
      resolve({ ok: false, error: errMsg, stderr, data });
    });
  });
}

/**
 * 创建临时输出目录，供 task get --output 使用。
 * @returns {string} 临时目录绝对路径
 */
function makeCliOutputDir() {
  const dir = path.join(os.tmpdir(), `vidu-cli-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 在输出目录中查找生成的媒体文件（视频/图片）。
 * CLI 下载的文件无固定命名，遍历目录取第一个匹配扩展名的文件。
 * @param {string} dir - 输出目录
 * @param {string[]} [exts] - 允许的扩展名（小写无点），默认视频
 * @returns {string|null} 文件绝对路径
 */
function findMediaInDir(dir, exts) {
  if (!dir || !fs.existsSync(dir)) return null;
  const allowed = exts || ['mp4', 'webm', 'mov', 'png', 'jpg', 'jpeg', 'webp'];
  let found = null;
  const walk = (d) => {
    if (found) return;
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) { walk(full); if (found) return; }
      else {
        const ext = path.extname(name).toLowerCase().replace(/^\./, '');
        if (allowed.includes(ext)) { found = full; return; }
      }
    }
  };
  try { walk(dir); } catch (_) {}
  return found;
}

/**
 * 递归删除目录（清理临时输出目录）。
 */
function cleanupDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

module.exports = {
  runViduCli,
  makeCliOutputDir,
  findMediaInDir,
  cleanupDir,
  DEFAULT_VIDU_CLI_BIN,
};
