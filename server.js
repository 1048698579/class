const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  Supabase 配置
// ================================================================
const SUPABASE_URL = 'https://dlgjlyygnqklpurlyybp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZ2pseXlnbnFrbHB1cmx5eWJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NDQ1MjgsImV4cCI6MjEwMzMyMDUyOH0.R9V_oK4jLFWpGOCtH8Kk1dj-Ji39I-5NyDOETLuiBeI';

// ================================================================
//  钉钉配置
// ================================================================
const DING = {
    main: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b', secret: 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857' },
    stats: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b', secret: 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857' },
    alert: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=efc6dd930c477c804acc351c3a4cc924b72539dfc3134dce62e9c94132a4dc4b', secret: 'SEC0d6e9d85a8adf73b7773fd3524192e70104e983d23ee3ee06c9ed4fe20608857' }
};

// ================================================================
//  中间件
// ================================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ================================================================
//  工具函数
// ================================================================
function sign(timestamp, secret) {
    return crypto.createHmac('sha256', secret).update(timestamp + '\n' + secret).digest('base64');
}

async function sendDingTalk(message, isEmergency, robot = 'main') {
    try {
        const r = DING[robot] || DING.main;
        const ts = Date.now();
        const url = r.webhook + '&timestamp=' + ts + '&sign=' + encodeURIComponent(sign(ts, r.secret));
        await axios.post(url, {
            msgtype: 'markdown',
            markdown: { title: isEmergency ? '🚨 紧急通知' : '📢 通知', text: message },
            at: { isAtAll: false }
        }, { headers: { 'Content-Type': 'application/json' } });
        return true;
    } catch (e) { console.error('钉钉发送失败:', e.message); return false; }
}

// ================================================================
//  Supabase 操作
// ================================================================
async function getData() {
    try {
        const r = await axios.get(SUPABASE_URL + '/rest/v1/system_data?id=eq.main', {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
        });
        return r.data && r.data[0] || null;
    } catch (e) { console.error('读取失败:', e.message); return null; }
}

async function saveData(data) {
    try {
        const payload = {
            class_data_list: data.classDataList || {},
            seat_status: data.seatStatus || {},
            teacher_status: data.teacherStatus || {},
            users: data.users || {},
            attendance_records: data.attendanceRecords || {}
        };
        const existing = await getData();
        if (existing) {
            await axios.patch(SUPABASE_URL + '/rest/v1/system_data?id=eq.main', payload, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }
            });
        } else {
            await axios.post(SUPABASE_URL + '/rest/v1/system_data', { id: 'main', ...payload }, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }
            });
        }
        return true;
    } catch (e) { console.error('保存失败:', e.message); return false; }
}

// ================================================================
//  API 路由
// ================================================================
app.get('/api/data', async (req, res) => {
    try {
        const d = await getData();
        if (d) {
            res.json({ success: true, data: {
                classDataList: d.class_data_list || {},
                seatStatus: d.seat_status || {},
                teacherStatus: d.teacher_status || {},
                users: d.users || {},
                attendanceRecords: d.attendance_records || {}
            }});
        } else {
            const defaultData = {
                classDataList: {},
                seatStatus: {},
                teacherStatus: {},
                users: { admin: { name: '超级管理员', role: '超级管理员', role_level: 5, password: 'admin123', permissions: { can_manage_users: true, can_manage_all_classes: true, can_manage_all_grades: true, can_view_all: true, can_comment_all: true, can_export_data: true, can_send_notification: true, can_manage_permissions: true } } },
                attendanceRecords: {}
            };
            await saveData(defaultData);
            res.json({ success: true, data: defaultData });
        }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/data', async (req, res) => {
    try {
        const ok = await saveData(req.body.data);
        res.json({ success: ok, message: ok ? '保存成功' : '保存失败' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/change-password', async (req, res) => {
    try {
        const { username, oldPassword, newPassword } = req.body;
        if (!username || !oldPassword || !newPassword) return res.status(400).json({ success: false, error: '参数不全' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, error: '密码至少6位' });
        const d = await getData();
        if (!d || !d.users[username]) return res.status(404).json({ success: false, error: '用户不存在' });
        if (d.users[username].password !== oldPassword) return res.status(401).json({ success: false, error: '原密码错误' });
        d.users[username].password = newPassword;
        await saveData(d);
        res.json({ success: true, message: '密码修改成功' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/praise-teacher', async (req, res) => {
    try {
        const { className, teacherName, reason, commenter } = req.body;
        const msg = '🌟 **教师表扬**\n\n🏫 班级：' + className + '\n👨‍🏫 教师：' + teacherName + '\n💬 理由：' + reason + '\n👤 表扬人：' + commenter + '\n🕐 ' + new Date().toLocaleString();
        await sendDingTalk(msg, false, 'main');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/praise-class', async (req, res) => {
    try {
        const { className, reason, commenter } = req.body;
        const msg = '🏆 **班级表扬**\n\n🏫 班级：' + className + '\n💬 理由：' + reason + '\n👤 表扬人：' + commenter + '\n🕐 ' + new Date().toLocaleString();
        await sendDingTalk(msg, false, 'main');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/batch-create-classes', async (req, res) => {
    try {
        const { startKey, count, namePrefix, nameSuffix } = req.body;
        if (!startKey || !count || count < 1 || count > 50) return res.status(400).json({ success: false, error: '参数错误' });
        const d = await getData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        if (!d.class_data_list) d.class_data_list = {};
        const base = parseInt(startKey.split('-')[1]);
        const year = startKey.split('-')[0];
        const gradeMap = { 1:'一年级',2:'二年级',3:'三年级',4:'四年级',5:'五年级',6:'六年级',7:'七年级',8:'八年级',9:'九年级',0:'高一年级' };
        let created = 0;
        for (let i = 0; i < count; i++) {
            const num = base + i;
            const key = year + '-' + String(num).padStart(3,'0');
            if (d.class_data_list[key]) continue;
            const g = gradeMap[parseInt(String(num).charAt(0))] || '未知年级';
            d.class_data_list[key] = {
                className: (namePrefix || g) + '(' + (num % 100) + '班)',
                classSub: '🏫 教室位置待设置',
                seatColumns: 8,
                teachers: [],
                schedule: [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']],
                students: [],
                diners: {},
                afterSchool: {}
            };
            created++;
        }
        await saveData(d);
        res.json({ success: true, message: '成功创建 ' + created + ' 个班级', created });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/batch-delete-classes', async (req, res) => {
    try {
        const { classKeys } = req.body;
        if (!classKeys || classKeys.length === 0) return res.status(400).json({ success: false, error: '请选择班级' });
        const d = await getData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        let deleted = 0;
        classKeys.forEach(k => { if (d.class_data_list && d.class_data_list[k]) { delete d.class_data_list[k]; deleted++; } });
        await saveData(d);
        res.json({ success: true, message: '成功删除 ' + deleted + ' 个班级', deleted });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/batch-update-classes', async (req, res) => {
    try {
        const { classKeys, oldText, newText, field } = req.body;
        if (!classKeys || classKeys.length === 0 || !oldText) return res.status(400).json({ success: false, error: '参数错误' });
        const d = await getData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        let updated = 0;
        classKeys.forEach(k => {
            const cls = d.class_data_list && d.class_data_list[k];
            if (!cls) return;
            if (field === 'className' || !field) { cls.className = cls.className.replace(new RegExp(oldText, 'g'), newText); updated++; }
            if (field === 'classSub' || field === 'all') { cls.classSub = cls.classSub.replace(new RegExp(oldText, 'g'), newText); updated++; }
        });
        await saveData(d);
        res.json({ success: true, message: '成功更新 ' + updated + ' 个班级', updated });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/diner-check', async (req, res) => {
    try {
        const config = await getData();
        const deadline = '09:00';
        const now = new Date();
        const [h, m] = deadline.split(':').map(Number);
        const d = new Date(now); d.setHours(h, m, 0, 0);
        res.json({ success: true, canEdit: now < d, deadline, currentTime: now.toLocaleTimeString() });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/send', async (req, res) => {
    try {
        const { message, isEmergency, robot = 'main' } = req.body;
        const ok = await sendDingTalk(message, isEmergency, robot);
        res.json({ success: ok });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/health', (req, res) => res.send('OK'));

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log('🚀 服务已启动，端口:', PORT);
    console.log('📡 访问地址: https://class-pwy0.onrender.com');
});
