import {chromium} from "playwright";
import chalk from 'chalk';


// 修改为任意一个章节的 url。
const url_login = "http://mooc.mooc.ucas.edu.cn/mooc-ans/mycourse/studentstudy?chapterId=577981&courseId=350140000036093&clazzid=350140000030821&enc=edff99c796a16a202be4ec9b311a2179";
const edge_path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';  // 修改为 Chrome 浏览器的路径
const username = '';   // 手机号码
const password = '';    // 密码


async function deal_video(page) {
    const videoFrameCount = await page.frameLocator('#iframe').locator('iframe[src*="video"]').count();
    if (videoFrameCount === 0) {
        console.log(chalk.whiteBright(`   No video iframes found, skipping.`));
        return;
    }
    await page.frameLocator('#iframe').locator('iframe[src*="video"]').first().focus();
    let video_iframes = [];
    const iframes = page.frames();
    for (let frame of iframes) {
        if (frame.url().includes('video')) {
            video_iframes.push(frame);
        }
    }
    console.log(chalk.whiteBright(`   Found ${video_iframes.length} iframes with src containing "video".`));

    for (let i = 0; i < video_iframes.length; i++) {
        const video_iframe = video_iframes[i];
        const job_id = await video_iframe.parentFrame().locator('iframe[src*="video"]').nth(i).getAttribute("jobid");
        const video = await video_iframe.locator('video');

        // 用 page.on('response') 监听服务器返回的 isPassed
        let isCompleted = false;
        const onResponse = async (response) => {
            const url = response.url();
            if (url.includes('multimedia/log') && url.includes(`jobid=${job_id}`)) {
                try {
                    const data = await response.json();
                    const pt = new URL(url).searchParams.get('playingTime');
                    console.log(chalk.yellowBright(`       [DEBUG] playingTime=${pt} isPassed=${data.isPassed}`));
                    if (data.isPassed) {
                        isCompleted = true;
                    }
                } catch (e) {}
            }
        };
        page.on('response', onResponse);

        // 点击 Video.js 原生播放按钮，2x 倍速 + 禁止自动跳转（多方案一起上）
        const playResult = await video_iframe.evaluate(() => {
            const btn = document.querySelector('.vjs-big-play-button');
            if (btn) btn.click();

            const v = document.querySelector('video');
            if (!v) return 'no video';
            v.muted = true;

            // 方法1：拦截原生 ended，强制在当前视频尾部循环
            v.addEventListener('ended', (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                v.currentTime = v.duration - 10;
                v.play();
            }, true);

            // 方法2：延迟等 Video.js 初始化后，覆盖其 trigger 吞掉 ended
            setTimeout(() => {
                const el = document.querySelector('.video-js');
                if (el && el.player) {
                    const orig = el.player.trigger.bind(el.player);
                    el.player.trigger = function(name) {
                        if (name === 'ended') return;
                        return orig(name);
                    };
                }
            }, 2000);

            // 延迟设 2x 倍速 + 每秒强制覆盖
            setTimeout(() => {
                const video = document.querySelector('video');
                if (video) {
                    video.playbackRate = 2;
                    setInterval(() => { video.playbackRate = 2; }, 1000);
                }
            }, 1500);

            return 'clicked';
        });
        console.log(chalk.whiteBright(`       Play trigger: ${playResult}`));

        // 防止鼠标检测导致暂停（暴力版）
        await video_iframe.evaluate(() => {
            const v = document.querySelector('video');
            if (!v) return;

            // 1. 拦截原生 pause 事件
            v.addEventListener('pause', () => v.play());
            v.muted = true;

            // 2. 拦截 Video.js 等播放器 API 的 pause
            // 有些播放器把实例挂在 video 元素的 parent 上
            const playerDiv = v.closest('.video-js, [class*="player"]');
            if (playerDiv && playerDiv.player) {
                const origPause = playerDiv.player.pause?.bind(playerDiv.player);
                playerDiv.player.pause = () => {};
                playerDiv.player.play = () => {};
            }

            // 3. 暴力轮询：每 500ms 检查一次，如果暂停了就继续播
            setInterval(() => {
                if (v.paused) v.play();
            }, 500);
        });

        // 等等视频加载完再读时长
        const duration = await video_iframe.evaluate(() => {
            return new Promise(resolve => {
                const v = document.querySelector('video');
                if (!v) { resolve(600); return; }
                if (v.readyState >= 1 && !isNaN(v.duration)) { resolve(v.duration); return; }
                const done = () => resolve(v.duration || 600);
                v.addEventListener('loadedmetadata', done, { once: true });
                setTimeout(() => { v.removeEventListener('loadedmetadata', done); resolve(v.duration || 600); }, 8000);
            });
        }).catch(() => 600);
        const waitTimeout = Math.max(duration * 1000 / 2 * 3 + 120000, 600000);
        console.log(chalk.whiteBright(`       duration=${Math.floor(duration)}s, timeout=${Math.floor(waitTimeout / 1000)}s`));

        // 等 isPassed，超时兜底
        const waitStart = Date.now();
        while (!isCompleted && Date.now() - waitStart < waitTimeout) {
            await page.waitForTimeout(1000);
        }
        page.off('response', onResponse);

        if (isCompleted) {
            console.log(chalk.greenBright("       Video has finished playing"));
        } else {
            console.log(chalk.yellowBright("       Video wait timed out, continuing."));
        }
    }
}


async function deal_pdf(page) {
    // 先检查有没有 PDF iframe，没有就直接跳过
    const pdfFrameCount = await page.frameLocator('#iframe').locator('iframe[src*="pdf"]').count();
    if (pdfFrameCount === 0) {
        console.log(chalk.whiteBright(`   No pdf iframes found, skipping.`));
        return;
    }
    // dirty hack: 利用 playwright focus() 的自动等待，来解决 count() 遇到的 "Execution context was destroyed" 问题  以及 count() 不全的问题。   也可以用 waitFor()
    await page.frameLocator('#iframe').locator('iframe[src*="pdf"]').first().focus();
    const iframes = await page.frameLocator('#iframe').locator('iframe[src*="pdf"]');
    const iframeCount = await iframes.count();
    console.log(chalk.whiteBright(`   Found ${iframeCount} iframes with src containing "pdf".`));

   const scriptContent_iframe = (await page.frameLocator('#iframe').locator('script').evaluateAll(scripts => scripts.map(script => script.innerText))).join('\n');

    // Extract stu_CourseId and stu_clazzId using regular expressions
    let stu_CourseId = await page.locator('input[id="curCourseId"]').inputValue();
    let stu_clazzId = await page.locator('input[id="curClazzId"]').inputValue();
    let jtoken = null;
    let knowledgeid = await page.locator('input[id="curChapterId"]').inputValue();

    let jtokenMatch = scriptContent_iframe.matchAll(/"jtoken":"(\w+)",/g);
    let jtokens = Array.from(jtokenMatch, m => m[1]);

    // console.log(`stu_CourseId: ${stu_CourseId}`);
    // console.log(`stu_clazzId: ${stu_clazzId}`);
    // console.log(`knowledgeid: ${knowledgeid}`);

    let pdf_finish_url = 'https://mooc.mooc.ucas.edu.cn/ananas/job/document';

    // 构造请求。
    let iframe = null;
    for (let i = 0; i < iframeCount; i++) {
        if (jtokens) {
            jtoken = jtokens[i];
        }

        iframe = await iframes.nth(i);
        const job_id = await iframe.getAttribute("jobid");
        // console.log("       job_id: " + job_id);

        const response = await page.request.get(pdf_finish_url, {
            params: {
                jobid: job_id,
                knowledgeid: knowledgeid,
                courseid: stu_CourseId,
                clazzid: stu_clazzId,
                jtoken: jtoken,
                checkMicroTopic: "false",
                microTopicId: "undefined",
                _dc: Date.now(),

            },
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (data.status) {
            console.log(chalk.greenBright("       " + JSON.stringify(data)));
        }else{
            console.log(chalk.yellowBright("       " + JSON.stringify(data)));
        }
    }

}


(async () => {
    const browser = await chromium.launch({
        headless: false,
        // proxy:{
        //     "server": "http://127.0.0.1:8080" // 代理
        // },
        executablePath: edge_path  // 如果使用 playwright 安装的 chromium ，会由于没有 flash 导致播放不了视频。
    });
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    const page = await context.newPage();
    await page.goto(url_login);
    await page.waitForURL(/passport.mooc.ucas.edu.cn/);
    await page.getByPlaceholder('手机号/超星号').fill(username);
    await page.getByPlaceholder('学习通密码').fill(password);
    let promise_a = page.waitForNavigation();   // waitForNavigation Deprecated ,但是没找到合适替换的。  https://github.com/microsoft/playwright/issues/20853
    await page.getByRole('button', {name: '登录'}).click();
    await promise_a;

    // 页面新结构：每个 ncells 是一个章节/小节，H4 里有 jobUnfinishCount，文字在 ncells 内
    // Quiz 通过 ncells 文字中的 "Quiz" 关键词排除
    await page.locator('#coursetree .ncells:has(input.jobUnfinishCount)').first().waitFor();
    const ncellsLocator = page.locator('#coursetree .ncells:has(input.jobUnfinishCount)');
    const totalCount = await ncellsLocator.count();

    // 每次循环重新扫描课程树，找第一个未完成的小节，自然跟随页面的自动翻页
    const processedIds = new Set();  // 已处理过的小节不再重复处理
    while (true) {
        const ncells = page.locator('#coursetree .ncells:has(input.jobUnfinishCount)');
        const count = await ncells.count();

        let found = false;
        for (let i = 0; i < count; i++) {
            const cell = ncells.nth(i);
            const text = (await cell.textContent()).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            const h4id = await cell.locator('h4').getAttribute('id');
            const jobVal = await cell.locator('input.jobUnfinishCount').getAttribute('value');

            if (/quiz/i.test(text)) continue;
            if (jobVal === '0' || !jobVal) continue;
            if (processedIds.has(h4id)) continue;  // 本轮已处理过，跳过

            // 找到第一个未完成的小节
            found = true;
            processedIds.add(h4id);
            console.log(chalk.whiteBright("--------------------------"));
            console.log(chalk.blueBright(`开始处理：${text} (${jobVal}个任务)`));

            // 如果当前不是选中状态才点击
            const isCurrent = await cell.locator('h4.currents').count() > 0;
            if (!isCurrent) {
                await cell.locator('h4 span[onclick]').click();
                try {
                    await page.frameLocator('#iframe').locator('iframe[src*="video"], iframe[src*="pdf"]').first().waitFor({ timeout: 8000 });
                } catch (e) {
                    console.log(chalk.yellowBright("   等待内容加载超时，跳过…"));
                    break;  // break 出 for，重新扫描
                }
                await page.waitForTimeout(500);
            }

            await deal_video(page);
            await deal_pdf(page);
            break;  // 处理完一个，重新扫描
        }

        if (!found) {
            console.log(chalk.magentaBright("所有任务已完成！"));
            break;
        }
    }

    await browser.close();


})();





