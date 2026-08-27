const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  Supabase 配置（已确认正确）
// ================================================================
const SUPABASE_URL = 'https://dlgjlyygnqklpurlyybp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZ2pseXlnbnFrbHB1cmx5eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NDQ1MjgsImV4cCI6MjEwMzMyMDUyOH0.R9V_oK4jLFWpGOCtH8Kk1dj-Ji39I-5NyDOETLuiBeI';

// ================================================================
//  钉钉机器人配置（已填入你的实际密钥）
// ================================================================
const DING_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b';
const DING_SECRET = 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857';

// ================================================================
//  中间件
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
//  钉钉签名函数
// ================================================================
function sign(timestamp, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(timestamp + '\n' + secret);
    return hmac.digest('base64');
}

// ================================================================
//  Supabase 数据操作
// ================================================================
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
        console.error('❌ 读取 Supabase 失败:', error.message);
        return null;
    }
}

async function saveSupabaseData(data) {
    try {
        const payload = {
            class_data_list: data.classDataList || {},
            seat_status: data.seatStatus || {},
            teacher_status: data.teacherStatus || {},
            users: data.users || {},
            attendance_records: data.attendanceRecords || {}
        };

        const existing = await getSupabaseData();
        if (existing) {
            await axios.patch(
                SUPABASE_URL + '/rest/v1/system_data?id=eq.main',
                payload,
                {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
        } else {
            await axios.post(
                SUPABASE_URL + '/rest/v1/system_data',
                { id: 'main', ...payload },
                {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
        }
        console.log('✅ 数据保存到 Supabase 成功');
        return true;
    } catch (error) {
        console.error('❌ 数据保存失败:', error.message);
        if (error.response) {
            console.error('   状态码:', error.response.status);
            console.error('   错误详情:', error.response.data);
        }
        return false;
    }
}

// ================================================================
//  API 接口
// ================================================================

// 获取数据（如无数据则自动初始化 admin）
app.get('/api/data', async (req, res) => {
    try {
        let data = await getSupabaseData();
        if (!data) {
            console.log('📦 数据库为空，自动初始化超级管理员...');
            const defaultData = {
                classDataList: {},
                seatStatus: {},
                teacherStatus: {},
                users: {
                    admin: {
                        name: '超级管理员',
                        role: '超级管理员',
                        role_level: 5,
                        grade: null,
                        class: null,
                        password: 'admin123',
                        permissions: {
                            can_manage_users: true,
                            can_manage_all_classes: true,
                            can_manage_all_grades: true,
                            can_view_all: true,
                            can_comment_all: true
                        }
                    }
                },
                attendanceRecords: {}
            };
            await saveSupabaseData(defaultData);
            data = await getSupabaseData();
        }

        res.json({
            success: true,
            data: {
                classDataList: data?.class_data_list || {},
                seatStatus: data?.seat_status || {},
                teacherStatus: data?.teacher_status || {},
                users: data?.users || {},
                attendanceRecords: data?.attendance_records || {}
            }
        });
    } catch (error) {
        console.error('❌ /api/data 报错:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// 健康检查接口（用于 cron-job.org 唤醒）
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});
// 保存数据
app.post('/api/data', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data) {
            return res.status(400).json({ success: false, error: '缺少数据' });
        }
        const ok = await saveSupabaseData(data);
        if (ok) {
            res.json({ success: true, message: '数据保存成功' });
        } else {
            res.status(500).json({ success: false, error: '保存失败' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 钉钉消息转发（已配置真实密钥）
app.post('/send', async (req, res) => {
    try {
        const { message, isEmergency } = req.body;
        console.log('📨 准备发送钉钉消息:', message?.substring(0, 50) + '...');

        const timestamp = Date.now();
        const signValue = sign(timestamp, DING_SECRET);
        const url = DING_WEBHOOK + '&timestamp=' + timestamp + '&sign=' + encodeURIComponent(signValue);

        const payload = {
            msgtype: 'markdown',
            markdown: {
                title: isEmergency ? '🚨 教学异常通报' : '📢 课堂点评通知',
                text: message || '无内容'
            },
            at: { isAtAll: false }
        };

        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('✅ 钉钉发送成功:', response.data);
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error('❌ 钉钉发送失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 静态首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ================================================================
//  启动服务
// ================================================================
app.listen(PORT, async () => {
    console.log(`🚀 服务已启动，端口: ${PORT}`);
    console.log(`📡 访问地址: https://class-pwv8.onrender.com`);
    console.log(`🔔 钉钉机器人已配置: ${DING_WEBHOOK ? '✅ 是' : '❌ 否'}`);
});
