const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  Supabase 配置（已确认正确）
// ================================================================
const SUPABASE_URL = 'https://tvfiykgnfkhlhrlyybw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2Zml5eWtnbmZrbHBIcmx5eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NDQ1MjgsImV4cCI6MjEyMzMyMDUyOH0.R9V_oK4jLFWpgOCToh8Kk1dj-Ji39I-5NyD0ETLuiBeI';

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
//  钉钉配置（暂不启用，留空即可）
// ================================================================
const DING_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b';
const DING_SECRET = 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857';

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
        console.error('从 Supabase 读取失败:', error.message);
        return null;
    }
}

async function saveSupabaseData(data) {
    try {
        const existing = await getSupabaseData();
        if (existing) {
            await axios.patch(
                SUPABASE_URL + '/rest/v1/system_data?id=eq.main',
                {
                    class_data_list: data.classDataList || {},
                    seat_status: data.seatStatus || {},
                    teacher_status: data.teacherStatus || {},
                    users: data.users || {},
                    attendance_records: data.attendanceRecords || {}
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
            await axios.post(
                SUPABASE_URL + '/rest/v1/system_data',
                {
                    id: 'main',
                    class_data_list: data.classDataList || {},
                    seat_status: data.seatStatus || {},
                    teacher_status: data.teacherStatus || {},
                    users: data.users || {},
                    attendance_records: data.attendanceRecords || {}
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

app.get('/api/data', async (req, res) => {
    try {
        let data = await getSupabaseData();

        // 如果数据库是空的，自动初始化超级管理员
        if (!data) {
            console.log('📦 数据库为空，正在初始化...');
            const initData = {
                classDataList: {},
                seatStatus: {},
                teacherStatus: {},
                attendanceRecords: {},
                users: {
                    "admin": {
                        "name": "超级管理员",
                        "role": "超级管理员",
                        "role_level": 5,
                        "grade": null,
                        "class": null,
                        "password": "123456",
                        "permissions": {
                            "can_manage_users": true,
                            "can_manage_all_classes": true,
                            "can_manage_all_grades": true,
                            "can_view_all": true,
                            "can_comment_all": true
                        }
                    }
                }
            };
            await saveSupabaseData(initData);
            data = await getSupabaseData();
            console.log('✅ 超级管理员已自动创建（账号: admin, 密码: 123456）');
        }

        if (data) {
            res.json({
                success: true,
                data: {
                    classDataList: data.class_data_list || {},
                    seatStatus: data.seat_status || {},
                    teacherStatus: data.teacher_status || {},
                    users: data.users || {},
                    attendanceRecords: data.attendance_records || {}
                }
            });
        } else {
            res.json({
                success: true,
                data: {
                    classDataList: {},
                    seatStatus: {},
                    teacherStatus: {},
                    users: {},
                    attendanceRecords: {}
                }
            });
        }
    } catch (error) {
        console.error('读取数据失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/send', async (req, res) => {
    try {
        const { message, isEmergency } = req.body;
        console.log('📨 收到消息:', message ? message.substring(0, 80) + '...' : '空消息');

        // 如果钉钉未配置，只打印日志
        if (!DING_WEBHOOK) {
            console.log('⚠️ 钉钉未配置，消息仅打印:', message);
            res.json({ success: true, message: '消息已记录（钉钉未配置）' });
            return;
        }

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
    console.log('🚀 服务已启动，端口:', PORT);
    console.log('📡 访问地址: https://class-pwy0.onrender.com');

    // 启动时检查数据库，自动初始化
    try {
        const data = await getSupabaseData();
        if (!data) {
            console.log('📦 首次启动，正在初始化数据库...');
            const initData = {
                classDataList: {},
                seatStatus: {},
                teacherStatus: {},
                attendanceRecords: {},
                users: {
                    "admin": {
                        "name": "超级管理员",
                        "role": "超级管理员",
                        "role_level": 5,
                        "grade": null,
                        "class": null,
                        "password": "123456",
                        "permissions": {
                            "can_manage_users": true,
                            "can_manage_all_classes": true,
                            "can_manage_all_grades": true,
                            "can_view_all": true,
                            "can_comment_all": true
                        }
                    }
                }
            };
            await saveSupabaseData(initData);
            console.log('✅ 数据库初始化完成！');
            console.log('🔑 超级管理员账号: admin');
            console.log('🔑 超级管理员密码: 123456');
        } else {
            console.log('✅ 数据库已就绪');
        }
    } catch (error) {
        console.error('⚠️ 数据库初始化检查失败:', error.message);
    }
});