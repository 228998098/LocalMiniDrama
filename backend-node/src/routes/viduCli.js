const aiConfigService = require('../services/aiConfigService');
const viduCli = require('../services/viduCli');
const response = require('../response');

/**
 * 查询 vidu-cli claw_pass 订阅额度。
 * 从 video 类型配置中找 vidu_cli 厂商，取其 api_key 作为 VIDU_TOKEN，
 * 调用 `vidu-cli quota pass` 返回剩余/总额度。
 */
function quota(db, log) {
  return async (req, res) => {
    try {
      // 找 vidu_cli 配置：优先 video 类型，其次 image/storyboard_image
      const types = ['video', 'image', 'storyboard_image'];
      let config = null;
      for (const t of types) {
        const configs = aiConfigService.listConfigs(db, t) || [];
        config = configs.find((c) => {
          const p = String(c.provider || '').toLowerCase();
          const proto = String(c.api_protocol || '').toLowerCase();
          return p === 'vidu_cli' || p === 'viducli' || proto === 'vidu_cli' || proto === 'viducli';
        }) || configs.find((c) => c.is_default && c.is_active);
        if (config) break;
      }
      if (!config) {
        return response.success(res, { available: false, message: '未配置 vidu_cli 厂商' });
      }
      if (!config.api_key) {
        return response.success(res, { available: false, message: 'vidu_cli 配置缺少 api_key（token）' });
      }

      const fakeLog = log || { info: () => {}, warn: () => {}, error: () => {} };
      const result = await viduCli.runViduCli(config, ['quota', 'pass'], fakeLog, { timeoutMs: 30000 });
      if (!result.ok) {
        return response.success(res, { available: false, message: result.error || '查询额度失败' });
      }
      const d = result.data || {};
      return response.success(res, {
        available: true,
        has_pass: !!d.has_pass,
        remain_seconds: d.remain_seconds != null ? d.remain_seconds : null,
        daily_quota_seconds: d.daily_quota_seconds != null ? d.daily_quota_seconds : null,
        used_seconds: d.used_seconds != null ? d.used_seconds : null,
        tier: d.tier || null,
        next_refresh_at: d.next_refresh_at || null,
      });
    } catch (e) {
      return response.success(res, { available: false, message: '查询额度异常：' + (e.message || e) });
    }
  };
}

module.exports = function (db, log) {
  const router = require('express').Router();
  router.get('/quota', quota(db, log));
  return router;
};
