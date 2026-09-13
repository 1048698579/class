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

const SUPA_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
};

// ================================================================
//  system_data 读写（班级/用户，不含考勤）
// ================================================================
async function getSystemData() {
    try {
        const r = await axios.get(SUPABASE_URL + '/rest/v1/system_data?id=eq.main', { headers: SUPA_HEADERS });
        return r.data && r.data[0] || null;
    } catch (e) { console.error('读取 system_data 失败:', e.message); return null; }
}

async function saveSystemData(data) {
    try {
        const existing = await getSystemData();

        const payload = {
            class_data_list: data.classDataList || {},
            seat_status: data.seatStatus || {},
            teacher_status: data.teacherStatus || {},
            users: data.users || {}
        };

        // 保护逻辑：前端传空时保留数据库的
        if (existing) {
            if (existing.class_data_list && Object.keys(existing.class_data_list).length > 0) {
                if (!payload.class_data_list || Object.keys(payload.class_data_list).length === 0) {
                    console.log('🛡️ 保留现有班级数据');
                    payload.class_data_list = existing.class_data_list;
                }
            }
            if (existing.users && Object.keys(existing.users).length > 0) {
                if (!payload.users || Object.keys(payload.users).length === 0) {
                    console.log('🛡️ 保留现有用户数据');
                    payload.users = existing.users;
                }
            }
        }

        if (existing) {
            await axios.patch(SUPABASE_URL + '/rest/v1/system_data?id=eq.main', payload, { headers: SUPA_HEADERS });
        } else {
            await axios.post(SUPABASE_URL + '/rest/v1/system_data', { id: 'main', ...payload }, { headers: SUPA_HEADERS });
        }
        return true;
    } catch (e) {
        console.error('❌ 保存 system_data 失败:', e.message);
        if (e.response) console.error('响应:', e.response.status, e.response.data);
        return false;
    }
}

// ================================================================
//  attendance_records 读写（每班每天一行）
// ================================================================
async function getAttendanceByRange(classKey, start, end) {
    try {
        let url = SUPABASE_URL + '/rest/v1/attendance_records?select=*';
        if (classKey && classKey !== 'all') {
            url += '&class_key=eq.' + encodeURIComponent(classKey);
        }
        if (start) url += '&date=gte.' + start;
        if (end) url += '&date=lte.' + end;
        url += '&order=date.asc';

        const r = await axios.get(url, { headers: SUPA_HEADERS });
        return r.data || [];
    } catch (e) {
        console.error('读取考勤失败:', e.message);
        return [];
    }
}

async function saveAttendanceDay(classKey, date, data) {
    try {
        await axios.post(
            SUPABASE_URL + '/rest/v1/attendance_records?on_conflict=class_key,date',
            {
                class_key: classKey,
                date: date,
                data: data || {},
                updated_at: new Date().toISOString()
            },
            {
                headers: {
                    ...SUPA_HEADERS,
                    'Prefer': 'resolution=merge-duplicates,return=minimal'
                }
            }
        );
        return true;
    } catch (e) {
        console.error('保存考勤失败:', e.message);
        if (e.response) console.error('响应:', e.response.status, e.response.data);
        return false;
    }
}

// ================================================================
//  🛡️ 爬虫防护
// ================================================================
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /');
});

app.use((req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    const blockedAgents = ['python-requests', 'Go-http-client', 'curl', 'Wget', 'Java', 'okhttp', 'Scrapy', 'HttpClient', 'Apache-HttpClient', 'python', 'PhantomJS', 'HeadlessChrome'];
    for (let i = 0; i < blockedAgents.length; i++) {
        if (ua.indexOf(blockedAgents[i]) !== -1) {
            console.log('🛡️ 已屏蔽爬虫:', ua);
            res.status(403).send('Forbidden');
            return;
        }
    }
    const blockedPaths = ['/.env', '/config', '/wp-admin', '/admin', '/.git', '/vendor', '/app/config', '/.aws', '/credentials', '/.ssh'];
    for (let i = 0; i < blockedPaths.length; i++) {
        if (req.path === blockedPaths[i] || req.path.indexOf(blockedPaths[i] + '/') === 0) {
            console.log('🛡️ 已屏蔽敏感路径:', req.path);
            res.status(403).send('Forbidden');
            return;
        }
    }
    next();
});

// ================================================================
//  API: 班级/用户数据
// ================================================================
app.get('/api/data', async (req, res) => {
    try {
        const d = await getSystemData();
        if (d) {
            res.json({ success: true, data: {
                classDataList: d.class_data_list || {},
                seatStatus: d.seat_status || {},
                teacherStatus: d.teacher_status || {},
                users: d.users || {}
            }});
        } else {
            const defaultData = {
                classDataList: {},
                seatStatus: {},
                teacherStatus: {},
                users: { admin: { name: '超级管理员', role: '超级管理员', role_level: 5, password: 'admin123' } }
            };
            await saveSystemData(defaultData);
            res.json({ success: true, data: defaultData });
        }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/data', async (req, res) => {
    try {
        const ok = await saveSystemData(req.body.data);
        res.json({ success: ok, message: ok ? '保存成功' : '保存失败' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
//  API: 总览汇总（一次返回所有班指定日期的汇总）
// ================================================================
app.get('/api/dashboard-summary', async (req, res) => {
    try {
        const date = req.query.date;
        if (!date) return res.status(400).json({ success: false, error: '缺少日期' });

        // 并行拉取：当天考勤 + 班级名单（含长期资格）
        const [attRes, sysRes] = await Promise.all([
            axios.get(
                SUPABASE_URL + '/rest/v1/attendance_records?select=class_key,data&date=eq.' + date,
                { headers: SUPA_HEADERS }
            ),
            axios.get(
                SUPABASE_URL + '/rest/v1/system_data?id=eq.main',
                { headers: SUPA_HEADERS }
            )
        ]);

        const attendanceMap = {};
        for (const row of (attRes.data || [])) {
            attendanceMap[row.class_key] = row.data || {};
        }
        const sys = sysRes.data && sysRes.data[0] ? sysRes.data[0] : {};
        const classDataList = sys.class_data_list || {};

        const summary = {};

        // 遍历所有班级（不只是有记录的）
        for (const classKey in classDataList) {
            const cls = classDataList[classKey];
            const students = cls.students || [];
            const diners = cls.diners || {};
            const afterClass1 = cls.afterClass1 || {};
            const afterClass2 = cls.afterClass2 || {};
            const rec = attendanceMap[classKey] || {};

            let present = 0, late = 0, absent = 0, leave = 0, notIn = 0;
            let diner = 0, after1 = 0, after2 = 0;

            for (let i = 0; i < students.length; i++) {
                const name = students[i];
                if (!name || name.trim() === '') continue;

                // 出勤状态（没记录 = 默认到课）
                let status = 'present';
                if (typeof rec[name] === 'string') status = rec[name];

                if (status === 'present') present++;
                else if (status === 'late') late++;
                else if (status === 'absent') absent++;
                else if (status === 'leave') leave++;
                else if (status === 'not-in-room') notIn++;

                // 是否停（请假/缺勤不算就餐/课后）
                const isStop = (status === 'leave' || status === 'absent');

                // 就餐：优先按天覆盖，否则读长期资格
                let dayDiner = (rec['_diner_' + name] !== undefined)
                    ? rec['_diner_' + name]
                    : (diners[name] || false);
                if (dayDiner && !isStop) diner++;

                // 课后1
                let dayA1 = (rec['_after1_' + name] !== undefined)
                    ? rec['_after1_' + name]
                    : (afterClass1[name] || false);
                if (dayA1 && !isStop && status !== 'not-in-room') after1++;

                // 课后2
                let dayA2 = (rec['_after2_' + name] !== undefined)
                    ? rec['_after2_' + name]
                    : (afterClass2[name] || false);
                if (dayA2 && !isStop && status !== 'not-in-room') after2++;
            }

            summary[classKey] = { present, late, absent, leave, notIn, diner, after1, after2 };
        }

        res.json({ success: true, date, summary });
    } catch (e) {
        console.error('总览汇总失败:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//  API: 批量拉取多班某月数据（导出用）
// ================================================================
app.get('/api/attendance-batch', async (req, res) => {
    try {
        const { classKeys, month } = req.query;
        if (!classKeys || !month) return res.status(400).json({ success: false, error: '缺少参数' });
        const keys = classKeys.split(',').filter(function(k) { return k; });
        if (keys.length === 0) return res.status(400).json({ success: false, error: '无班级' });

        const [y, m] = month.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const start = month + '-01';
        const end = month + '-' + String(lastDay).padStart(2, '0');

        // Supabase in 查询
        const inList = keys.map(function(k) { return '"' + k + '"'; }).join(',');
        const url = SUPABASE_URL + '/rest/v1/attendance_records?select=class_key,date,data' +
            '&class_key=in.(' + encodeURIComponent(inList) + ')' +
            '&date=gte.' + start + '&date=lte.' + end +
            '&order=date.asc&limit=10000';

        const r = await axios.get(url, { headers: SUPA_HEADERS });

        const result = {};
        for (const row of r.data) {
            if (!result[row.class_key]) result[row.class_key] = {};
            result[row.class_key][row.date] = row.data || {};
        }

        res.json({ success: true, month, data: result });
    } catch (e) {
        console.error('批量拉取失败:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//  API: 考勤读取（按班+月）
// ================================================================
app.get('/api/attendance', async (req, res) => {
    try {
        const { classKey, month, start, end } = req.query;
        let s = start, e = end;
        if (month) {
            s = month + '-01';
            // 计算月末
            const [y, m] = month.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            e = month + '-' + String(lastDay).padStart(2, '0');
        }
        if (!s || !e) return res.status(400).json({ success: false, error: '缺少时间范围' });
        if (!classKey) return res.status(400).json({ success: false, error: '缺少班级' });

        const rows = await getAttendanceByRange(classKey, s, e);
        // 转为 { date: data } 格式
        const result = {};
        for (const row of rows) {
            result[row.date] = row.data || {};
        }
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('读取考勤失败:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//  API: 考勤保存（单天）
// ================================================================
app.post('/api/attendance/save', async (req, res) => {
    try {
        const { classKey, date, data } = req.body;
        if (!classKey || !date) return res.status(400).json({ success: false, error: '缺少参数' });
        const ok = await saveAttendanceDay(classKey, date, data || {});
        res.json({ success: ok, message: ok ? '保存成功' : '保存失败' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//  API: 修改密码
// ================================================================
app.post('/api/change-password', async (req, res) => {
    try {
        const { username, oldPassword, newPassword } = req.body;
        if (!username || !oldPassword || !newPassword) return res.status(400).json({ success: false, error: '参数不全' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, error: '密码至少6位' });
        const d = await getSystemData();
        if (!d || !d.users || !d.users[username]) return res.status(404).json({ success: false, error: '用户不存在' });
        if (d.users[username].password !== oldPassword) return res.status(401).json({ success: false, error: '原密码错误' });
        d.users[username].password = newPassword;
        const savePayload = {
            classDataList: d.class_data_list,
            users: d.users,
            seatStatus: d.seat_status,
            teacherStatus: d.teacher_status
        };
        await saveSystemData(savePayload);
        res.json({ success: true, message: '密码修改成功' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
//  API: 表扬
// ================================================================
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

// ================================================================
//  API: 批量班级操作（基于 system_data）
// ================================================================
app.post('/api/batch-create-classes', async (req, res) => {
    try {
        const { startKey, count, namePrefix } = req.body;
        if (!startKey || !count || count < 1 || count > 50) return res.status(400).json({ success: false, error: '参数错误' });
        const d = await getSystemData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        const classData = d.class_data_list || {};
        const base = parseInt(startKey.split('-')[1]);
        const year = startKey.split('-')[0];
        let created = 0;
        for (let i = 0; i < count; i++) {
            const num = base + i;
            const key = year + '-' + String(num).padStart(3, '0');
            if (classData[key]) continue;
            const gradeMap = { 1:'一年级',2:'二年级',3:'三年级',4:'四年级',5:'五年级',6:'六年级',7:'七年级',8:'八年级',9:'九年级',0:'高一年级' };
            const g = gradeMap[parseInt(String(num).charAt(0))] || '未知年级';
            classData[key] = {
                className: (namePrefix || g) + '(' + (num % 100) + '班)',
                classSub: '🏫 教室位置待设置',
                seatColumns: 8,
                teachers: [],
                schedule: [['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','',''],['','','','','']],
                students: [],
                diners: {},
                afterSchool: {},
                afterClass1: {},
                afterClass2: {}
            };
            created++;
        }
        await saveSystemData({
            classDataList: classData,
            users: d.users,
            seatStatus: d.seat_status,
            teacherStatus: d.teacher_status
        });
        res.json({ success: true, message: '成功创建 ' + created + ' 个班级', created });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/batch-delete-classes', async (req, res) => {
    try {
        const { classKeys } = req.body;
        if (!classKeys || classKeys.length === 0) return res.status(400).json({ success: false, error: '请选择班级' });
        const d = await getSystemData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        const classData = d.class_data_list || {};
        let deleted = 0;
        classKeys.forEach(k => { if (classData[k]) { delete classData[k]; deleted++; } });
        await saveSystemData({
            classDataList: classData,
            users: d.users,
            seatStatus: d.seat_status,
            teacherStatus: d.teacher_status
        });
        res.json({ success: true, message: '成功删除 ' + deleted + ' 个班级', deleted });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/batch-update-classes', async (req, res) => {
    try {
        const { classKeys, oldText, newText, field } = req.body;
        if (!classKeys || classKeys.length === 0 || !oldText) return res.status(400).json({ success: false, error: '参数错误' });
        const d = await getSystemData();
        if (!d) return res.status(404).json({ success: false, error: '数据不存在' });
        const classData = d.class_data_list || {};
        let updated = 0;
        classKeys.forEach(k => {
            const cls = classData[k];
            if (!cls) return;
            if (field === 'className' || !field) { cls.className = cls.className.replace(new RegExp(oldText, 'g'), newText); updated++; }
            if (field === 'classSub' || field === 'all') { cls.classSub = cls.classSub.replace(new RegExp(oldText, 'g'), newText); updated++; }
        });
        await saveSystemData({
            classDataList: classData,
            users: d.users,
            seatStatus: d.seat_status,
            teacherStatus: d.teacher_status
        });
        res.json({ success: true, message: '成功更新 ' + updated + ' 个班级', updated });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ================================================================
//  API: 就餐锁
// ================================================================
app.get('/api/diner-check', async (req, res) => {
    try {
        const config = await getSystemConfig();
        const deadline = config && config.diner_deadline ? config.diner_deadline : '09:00';
        const now = new Date();
        const [h, m] = deadline.split(':').map(Number);
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        res.json({ success: true, canEdit: now < d, deadline, currentTime: now.toLocaleTimeString() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//  系统配置
// ================================================================
async function getSystemConfig() {
    try {
        const r = await axios.get(SUPABASE_URL + '/rest/v1/system_config?id=eq.main', { headers: SUPA_HEADERS });
        return r.data && r.data[0] || null;
    } catch (e) { return null; }
}

async function saveSystemConfig(config) {
    try {
        const existing = await getSystemConfig();
        const payload = {
            id: 'main',
            praise_comments: config.praise_comments || [],
            negative_comments: config.negative_comments || [],
            teacher_praise: config.teacher_praise || [],
            teacher_abnormal: config.teacher_abnormal || [],
            diner_deadline: config.diner_deadline || '09:00',
            alert_threshold: config.alert_threshold || 20,
            grade_fees: config.grade_fees || {},
            meal_price: config.meal_price !== undefined ? config.meal_price : 10,
            after_school_fee: config.after_school_fee !== undefined ? config.after_school_fee : 5
        };
        if (existing) {
            await axios.patch(SUPABASE_URL + '/rest/v1/system_config?id=eq.main', payload, { headers: SUPA_HEADERS });
        } else {
            await axios.post(SUPABASE_URL + '/rest/v1/system_config', payload, { headers: SUPA_HEADERS });
        }
        return true;
    } catch (e) {
        console.error('❌ 保存系统配置失败:', e.message);
        if (e.response) console.error('响应:', e.response.status, e.response.data);
        return false;
    }
}

app.get('/api/config', async (req, res) => {
    try {
        const config = await getSystemConfig();
        if (config) {
            res.json({ success: true, data: {
                praise_comments: config.praise_comments || ['🌟 听课专注', '🙋 积极发言', '📝 笔记认真', '🤝 善于合作', '💡 思维活跃'],
                negative_comments: config.negative_comments || ['💬 交头接耳', '😴 听课走神', '🤫 纪律差', '📱 注意力分散', '📢 随意讲话'],
                teacher_praise: config.teacher_praise || ['课堂气氛好', '备课充分', '精心辅导'],
                teacher_abnormal: config.teacher_abnormal || ['空堂', '上课玩手机', '上课迟到', '课堂有待提高'],
                diner_deadline: config.diner_deadline || '09:00',
                alert_threshold: config.alert_threshold || 20,
                grade_fees: config.grade_fees || {},
                meal_price: config.meal_price !== undefined ? config.meal_price : 10,
                after_school_fee: config.after_school_fee !== undefined ? config.after_school_fee : 5
            }});
        } else {
            res.json({ success: true, data: {
                praise_comments: ['🌟 听课专注', '🙋 积极发言', '📝 笔记认真', '🤝 善于合作', '💡 思维活跃'],
                negative_comments: ['💬 交头接耳', '😴 听课走神', '🤫 纪律差', '📱 注意力分散', '📢 随意讲话'],
                teacher_praise: ['课堂气氛好', '备课充分', '精心辅导'],
                teacher_abnormal: ['空堂', '上课玩手机', '上课迟到', '课堂有待提高'],
                diner_deadline: '09:00',
                alert_threshold: 20,
                grade_fees: {},
                meal_price: 10,
                after_school_fee: 5
            }});
        }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config', async (req, res) => {
    try {
        const { praise_comments, negative_comments, teacher_praise, teacher_abnormal, diner_deadline, alert_threshold, grade_fees, meal_price, after_school_fee } = req.body;
        const config = {
            praise_comments: praise_comments || ['🌟 听课专注', '🙋 积极发言', '📝 笔记认真', '🤝 善于合作', '💡 思维活跃'],
            negative_comments: negative_comments || ['💬 交头接耳', '😴 听课走神', '🤫 纪律差', '📱 注意力分散', '📢 随意讲话'],
            teacher_praise: teacher_praise || ['课堂气氛好', '备课充分', '精心辅导'],
            teacher_abnormal: teacher_abnormal || ['空堂', '上课玩手机', '上课迟到', '课堂有待提高'],
            diner_deadline: diner_deadline || '09:00',
            alert_threshold: alert_threshold || 20,
            grade_fees: grade_fees || {},
            meal_price: meal_price !== undefined ? meal_price : 10,
            after_school_fee: after_school_fee !== undefined ? after_school_fee : 5
        };
        const ok = await saveSystemConfig(config);
        res.json({ success: ok, message: ok ? '配置保存成功' : '保存失败' });
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
