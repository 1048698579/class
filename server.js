const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 允许所有跨域请求（解决CORS问题）
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    next();
});

app.use(express.json());

// 钉钉机器人配置
const DING_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b';
const DING_SECRET = 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857';

// 计算钉钉加签
function sign(timestamp, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(timestamp + '\n' + secret);
    return hmac.digest('base64');
}

// 接收前端请求，转发到钉钉
app.post('/send', async (req, res) => {
    try {
        const { message, isEmergency } = req.body;
        
        console.log('收到消息:', message);
        console.log('是否紧急:', isEmergency);

        const timestamp = Date.now();
        const signValue = sign(timestamp, DING_SECRET);
        const url = DING_WEBHOOK + '&timestamp=' + timestamp + '&sign=' + encodeURIComponent(signValue);

        const data = {
            msgtype: 'markdown',
            markdown: {
                title: isEmergency ? '?? 教学异常通报' : '?? 课堂点评通知',
                text: message
            },
            at: {
                isAtAll: false
            }
        };

        const response = await axios.post(url, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('钉钉响应:', response.data);
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error('发送失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const path = require('path');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log('?? 服务已启动，端口:', PORT);
});
