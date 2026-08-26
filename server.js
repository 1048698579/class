const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据文件路径
const DATA_FILE = path.join(__dirname, 'data.json');

// ===== CORS 配置 =====
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

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ===== 钉钉配置 =====
const DING_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b';
const DING_SECRET = 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857';

function sign(timestamp, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(timestamp + '\n' + secret);
    return hmac.digest('base64');
}

// ================================================================
//  数据读写函数
// ================================================================

// 读取数据
function readData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.log('读取数据失败，使用默认数据:', e.message);
    }
    return {};
}

// 写入数据
function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log('✅ 数据已保存到 data.json');
        return true;
    } catch (e) {
        console.log('❌ 数据保存失败:', e.message);
        return false;
    }
}

// ================================================================
//  默认数据
// ================================================================

function getDefaultData() {
    return {
        classDataList: {
            '2024-301': {
                className: '三年级(1)班',
                classSub: '🏫 教学楼2层 201教室',
                seatColumns: 8,
                teachers: [],
                schedule: [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']],
                students: []
            },
            '2024-302': {
                className: '三年级(2)班',
                classSub: '🏫 教学楼2层 202教室',
                seatColumns: 8,
                teachers: [],
                schedule: [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']],
                students: []
            },
            '2024-303': {
                className: '四年级(1)班',
                classSub: '🏫 教学楼3层 301教室',
                seatColumns: 8,
                teachers: [],
                schedule: [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']],
                students: []
            }
        },
        seatStatus: {},
        teacherStatus: {}
    };
}

// ================================================================
//  API 接口
// ================================================================

// ===== 获取所有数据 =====
app.get('/api/data', (req, res) => {
    const data = readData();
    res.json({ success: true, data: data });
});

// ===== 保存所有数据 =====
app.post('/api/data', (req, res) => {
    const { data } = req.body;
    if (!data) {
        res.status(400).json({ success: false, error: '缺少数据' });
        return;
    }
    const success = writeData(data);
    if (success) {
        res.json({ success: true, message: '数据保存成功' });
    } else {
        res.status(500).json({ success: false, error: '数据保存失败' });
    }
});

// ===== 获取指定班级数据 =====
app.get('/api/class/:classKey', (req, res) => {
    const classKey = req.params.classKey;
    const allData = readData();
    const classData = allData.classDataList && allData.classDataList[classKey] ? allData.classDataList[classKey] : null;
    if (!classData) {
        res.status(404).json({ success: false, error: '班级不存在' });
        return;
    }
    res.json({
        success: true,
        data: {
            classData: classData,
            seatStatus: allData.seatStatus || {},
            teacherStatus: allData.teacherStatus || {}
        }
    });
});

// ===== 保存班级数据 =====
app.post('/api/class/:classKey', (req, res) => {
    const classKey = req.params.classKey;
    const { classData, seatStatus, teacherStatus } = req.body;
    
    const allData = readData();
    if (!allData.classDataList) allData.classDataList = {};
    if (classData) allData.classDataList[classKey] = classData;
    if (seatStatus !== undefined) {
        if (!allData.seatStatus) allData.seatStatus = {};
        allData.seatStatus[classKey] = seatStatus;
    }
    if (teacherStatus !== undefined) {
        if (!allData.teacherStatus) allData.teacherStatus = {};
        allData.teacherStatus[classKey] = teacherStatus;
    }
    
    const success = writeData(allData);
    if (success) {
        res.json({ success: true, message: '班级数据保存成功' });
    } else {
        res.status(500).json({ success: false, error: '保存失败' });
    }
});

// ===== 钉钉消息转发 =====
app.post('/send', async (req, res) => {
    try {
        const { message, isEmergency } = req.body;
        console.log('📨 收到消息:', message ? message.substring(0, 80) + '...' : '空消息');

        const timestamp = Date.now();
        const signValue = sign(timestamp, DING_SECRET);
        const url = DING_WEBHOOK + '&timestamp=' + timestamp + '&sign=' + encodeURIComponent(signValue);

        const data = {
            msgtype: 'markdown',
            markdown: {
                title: isEmergency ? '🚨 教学异常通报' : '📢 课堂点评通知',
                text: message || '无内容'
            },
            at: { isAtAll: false }
        };

        const response = await axios.post(url, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('✅ 钉钉响应:', response.data);
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error('❌ 发送失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 返回首页 =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== 启动服务 =====
app.listen(PORT, () => {
    console.log('🚀 服务已启动，端口:', PORT);
    console.log('📡 访问地址: https://class-pwy0.onrender.com');
    console.log('💾 数据文件:', DATA_FILE);
});
