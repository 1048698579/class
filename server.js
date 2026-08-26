const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  🔴 Supabase 配置（替换成你的）
// ================================================================
const SUPABASE_URL = 'https://你的项目ID.supabase.co';  // 替换
const SUPABASE_KEY = '你的anon public密钥';           // 替换

// ================================================================
//  CORS 配置
// ================================================================
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

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ================================================================
//  钉钉配置
// ================================================================
const DING_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b';
const DING_SECRET = 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857';

function sign(timestamp, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(timestamp + '\n' + secret);
    return hmac.digest('base64');
}

// ================================================================
//  Supabase API 调用函数
// ================================================================

// 读取数据
async function getSupabaseData() {
    try {
        const response = await axios.get(
            SUPABASE_URL + '/rest/v1/system_data?id=eq.main',
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY
                }
            }
        );
        if (response.data && response.data.length > 0) {
            return response.data[0];
        }
        return null;
    } catch (error) {
        console.error('从 Supabase 读取失败:', error.message);
        return null;
    }
}

// 保存数据
async function saveSupabaseData(data) {
    try {
        // 先检查是否存在
        const existing = await getSupabaseData();
        if (existing) {
            // 更新
            await axios.patch(
                SUPABASE_URL + '/rest/v1/system_data?id=eq.main',
                {
                    class_data_list: data.classDataList || {},
                    seat_status: data.seatStatus || {},
                    teacher_status: data.teacherStatus || {},
                    users: data.users || {}
                },
                {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    }
                }
            );
        } else {
            // 插入
            await axios.post(
                SUPABASE_URL + '/rest/v1/system_data',
                {
                    id: 'main',
                    class_data_list: data.classDataList || {},
                    seat_status: data.seatStatus || {},
                    teacher_status: data.teacherStatus || {},
                    users: data.users || {}
                },
                {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
        }
        console.log('✅ 数据已保存到 Supabase');
        return true;
    } catch (error) {
        console.error('保存到 Supabase 失败:', error.message);
        return false;
    }
}

// ================================================================
//  API 接口
// ================================================================

// ===== 获取所有数据 =====
app.get('/api/data', async (req, res) => {
    try {
        const data = await getSupabaseData();
        if (data) {
            res.json({
                success: true,
                data: {
                    classDataList: data.class_data_list || {},
                    seatStatus: data.seat_status || {},
                    teacherStatus: data.teacher_status || {},
                    users: data.users || {}
                }
            });
        } else {
            // 返回空数据
            res.json({
                success: true,
                data: {
                    classDataList: {},
                    seatStatus: {},
                    teacherStatus: {},
                    users: {}
                }
            });
        }
    } catch (error) {
        console.error('读取数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 保存所有数据 =====
app.post('/api/data', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data) {
            res.status(400).json({ success: false, error: '缺少数据' });
            return;
        }

        const success = await saveSupabaseData(data);
        if (success) {
            res.json({ success: true, message: '数据保存成功' });
        } else {
            res.status(500).json({ success: false, error: '保存失败' });
        }
    } catch (error) {
        console.error('保存数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 获取指定班级数据 =====
app.get('/api/class/:classKey', async (req, res) => {
    try {
        const classKey = req.params.classKey;
        const data = await getSupabaseData();
        if (data && data.class_data_list && data.class_data_list[classKey]) {
            res.json({
                success: true,
                data: {
                    classData: data.class_data_list[classKey],
                    seatStatus: data.seat_status && data.seat_status[classKey] ? data.seat_status[classKey] : {},
                    teacherStatus: data.teacher_status && data.teacher_status[classKey] ? data.teacher_status[classKey] : {}
                }
            });
        } else {
            res.status(404).json({ success: false, error: '班级不存在' });
        }
    } catch (error) {
        console.error('读取班级数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 保存点评记录 =====
app.post('/api/comment', async (req, res) => {
    try {
        const comment = req.body;
        const response = await axios.post(
            SUPABASE_URL + '/rest/v1/comments',
            comment,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error('保存点评失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== 获取点评记录 =====
app.get('/api/comments/:classKey', async (req, res) => {
    try {
        const classKey = req.params.classKey;
        const response = await axios.get(
            SUPABASE_URL + '/rest/v1/comments?class_key=eq.' + classKey + '&order=created_at.desc&limit=100',
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY
                }
            }
        );
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error('读取点评失败:', error);
        res.status(500).json({ success: false, error: error.message });
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
});
