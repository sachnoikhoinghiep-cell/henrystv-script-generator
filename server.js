require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));

// Robust JSON extractor — handles markdown fences, leading/trailing prose
function extractJSON(text) {
  let s = text.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Try direct parse first
  try { return JSON.parse(s); } catch {}
  // Find outermost { } or [ ]
  const firstBrace  = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  let start = -1, closing;
  if (firstBrace === -1 && firstBracket === -1) throw new SyntaxError('No JSON found');
  if (firstBrace === -1) { start = firstBracket; closing = ']'; }
  else if (firstBracket === -1) { start = firstBrace; closing = '}'; }
  else if (firstBracket < firstBrace) { start = firstBracket; closing = ']'; }
  else { start = firstBrace; closing = '}'; }
  // Find matching close by counting depth
  const open = closing === '}' ? '{' : '[';
  let depth = 0, inStr = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === closing) { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i+1)); } catch {} break; } }
  }
  throw new SyntaxError('Cannot extract valid JSON from AI response');
}

const SYSTEM_PROMPT = `Bạn là một chuyên gia viết kịch bản YouTube kiêm chuyên gia SEO, đặc biệt xuất sắc trong ngách nội dung "Ứng dụng Minh triết Cổ đông (Kinh Dịch, Phật giáo, Đạo học, Tam Quốc) vào Quản trị Tâm lý và Xây dựng Nghệ thuật sống hiện đại". Văn phong của bạn mang tính triết lý, chữa lành sâu sắc nhưng thực tế, lạnh lùng, luôn đi ngược lại đám đông và không sáo rỗng.

QUAN TRỌNG: Bạn PHẢI trả về kết quả theo định dạng JSON hợp lệ, không có bất kỳ markdown code block nào bao ngoài. Chỉ trả về JSON thuần túy.`;

function buildUserPrompt(topic, videoLength, outlineParts) {
  const hookTime = Math.round(videoLength * 0.125);
  const bodyTime = Math.round(videoLength * 0.60);
  const realWorldTime = Math.round(videoLength * 0.175);
  const outroTime = Math.round(videoLength * 0.10);

  return `Dựa trên các biến số sau, hãy tạo outline kịch bản và trả về theo định dạng JSON.

Biến số đầu vào:
- Chủ đề (Topic): ${topic}
- Số phút video ước tính: ${videoLength} phút
- Số phần của Thân bài: ${outlineParts} phần

Phân bổ thời lượng:
- Phần 1 (Hook): ~${hookTime} phút
- Phần 2 (Thân bài): ~${bodyTime} phút (${outlineParts} phần, mỗi phần ~${Math.round(bodyTime/outlineParts)} phút)
- Phần 3 (Móc nối thực tế): ~${realWorldTime} phút
- Phần 4 (Kết bài & Outro): ~${outroTime} phút

Trả về JSON theo cấu trúc sau (KHÔNG dùng markdown, chỉ JSON thuần):
{
  "mode1": {
    "hook": {
      "duration": "${hookTime} phút",
      "sentences": ["câu hook 1", "câu hook 2"]
    },
    "body": {
      "duration": "${bodyTime} phút",
      "parts": [
        {
          "number": 1,
          "title": "tiêu đề luận điểm",
          "mainPoint": "nội dung luận điểm chính",
          "historicalStory": {
            "source": "nguồn gốc (VD: Tam Quốc / Kinh Dịch / Thiền sư X)",
            "story": "tóm tắt câu chuyện/điển cố lịch sử chi tiết"
          }
        }
      ]
    },
    "realWorld": {
      "duration": "${realWorldTime} phút",
      "applications": ["ứng dụng 1", "ứng dụng 2", "ứng dụng 3", "ứng dụng 4"]
    },
    "outro": {
      "duration": "${outroTime} phút",
      "zenSentence": "câu chốt mang tính thiền vị",
      "callToAction": "câu CTA hỏi mở"
    }
  }
}

Tạo đúng ${outlineParts} phần trong body.parts. Mỗi phần phải có câu chuyện lịch sử cụ thể, chi tiết, không chung chung.`;
}

app.post('/api/generate', async (req, res) => {
  const { topic, videoLength, outlineParts, apiKey } = req.body;

  if (!topic || !videoLength || !outlineParts) {
    return res.status(400).json({ error: 'Thiếu thông tin đầu vào' });
  }

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(400).json({ error: 'Chưa cấu hình API key' });
  }

  try {
    const client = new Anthropic({ apiKey: key });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(topic, parseInt(videoLength), parseInt(outlineParts))
        }
      ]
    });

    const data = extractJSON(response.content[0].text);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: 'Lỗi phân tích JSON từ AI. Vui lòng thử lại.' });
    } else {
      res.status(500).json({ error: err.message || 'Lỗi không xác định' });
    }
  }
});

const SECTION_WRITE_SYSTEM = `Bạn là chuyên gia viết kịch bản voiceover TTS (text-to-speech) cho YouTube chuyên ngách Minh Triết Cổ Đông.

QUY TẮC TUYỆT ĐỐI - KHÔNG ĐƯỢC VI PHẠM DÙ BẤT KỲ LÝ DO GÌ:
1. Chỉ trả về lời thoại thuần túy. Không tiêu đề, không nhãn, không ghi chú dạng nào.
2. Không dùng bất kỳ ký tự đặc biệt nào: * # ** [] {} | / \\ ~ ^ \` @ & > < =
3. Không viết ghi chú đạo diễn dưới bất kỳ hình thức nào: không [nhạc nền], không [dừng lại], không (pause), không [cắt cảnh].
4. Không dùng dấu gạch đầu dòng, không đánh số thứ tự.
5. Không dùng dấu ngoặc đơn hoặc ngoặc kép quá nhiều. Ưu tiên câu trần thuật.
6. Viết liền mạch, trôi chảy như lời người thật đang nói, ngắt đoạn tự nhiên bằng dòng trống.
7. Văn phong: triết lý, lạnh lùng, chữa lành sâu sắc, đi ngược đám đông nhưng không sáo rỗng.
8. Ngôn ngữ đầu ra: Tiếng Việt chuẩn, tự nhiên khi đọc to.`;

function buildSectionWritePrompt(sectionType, sectionData, topic, videoLength) {
  const wordsPerMin = 120;

  if (sectionType === 'hook') {
    const mins = parseFloat(sectionData.duration) || Math.round(videoLength * 0.125);
    const words = Math.round(mins * wordsPerMin);
    return `Viết kịch bản voiceover cho phần MỞ BÀI của video về chủ đề: ${topic}

Thời lượng: ${sectionData.duration} (khoảng ${words} từ)
Câu hook gợi ý từ outline: ${(sectionData.sentences || []).join(' / ')}

Yêu cầu: Bắt đầu ngay bằng câu hook gây chú ý, KHÔNG chào hỏi, KHÔNG giới thiệu bản thân. Mở rộng tâm lý, tạo cộng hưởng cảm xúc, dẫn dắt vào vấn đề. Kết thúc phần mở bằng câu chuyển tiếp tự nhiên vào thân bài.`;
  }

  if (sectionType === 'body_part') {
    const p = sectionData;
    const bodyMins = parseFloat(sectionData.partDuration) || 3;
    const words = Math.round(bodyMins * wordsPerMin);
    return `Viết kịch bản voiceover cho LUẬN ĐIỂM ${p.number} trong video về chủ đề: ${topic}

Thời lượng phần này: khoảng ${words} từ
Tiêu đề luận điểm: ${p.title}
Luận điểm chính: ${p.mainPoint}
Câu chuyện lịch sử sử dụng: [${p.historicalStory.source}] ${p.historicalStory.story}

Yêu cầu: Trình bày luận điểm, dẫn vào câu chuyện lịch sử một cách hấp dẫn như đang kể chuyện, sau đó rút ra bài học. Chảy mượt, không ngắt ý. Kết bằng câu chuyển tiếp sang phần tiếp theo.`;
  }

  if (sectionType === 'realworld') {
    const mins = parseFloat(sectionData.duration) || Math.round(videoLength * 0.175);
    const words = Math.round(mins * wordsPerMin);
    return `Viết kịch bản voiceover cho phần MÓC NỐI THỰC TẾ của video về chủ đề: ${topic}

Thời lượng: ${sectionData.duration} (khoảng ${words} từ)
Các ứng dụng thực tế cần triển khai: ${(sectionData.applications || []).join(' / ')}

Yêu cầu: Kéo triết lý cổ đại về đời sống hiện đại, cụ thể là môi trường công sở, quan hệ gia đình, áp lực KPI, mưu sinh, quan hệ xã hội. Viết như đang nói chuyện thật, người nghe nhận ra bản thân trong đó.`;
  }

  if (sectionType === 'outro') {
    const mins = parseFloat(sectionData.duration) || Math.round(videoLength * 0.10);
    const words = Math.round(mins * wordsPerMin);
    return `Viết kịch bản voiceover cho phần KẾT BÀI của video về chủ đề: ${topic}

Thời lượng: ${sectionData.duration} (khoảng ${words} từ)
Câu thiền vị từ outline: ${sectionData.zenSentence}
Câu CTA từ outline: ${sectionData.callToAction}

Yêu cầu: Đúc kết nhẹ nhàng, sâu sắc. Tạo cảm giác chữa lành và nâng đỡ tâm hồn. Kết thúc bằng câu hỏi mở khiến người xem muốn để lại bình luận. Sau đó thêm lời kêu gọi subscribe kênh tự nhiên, dùng đúng tên thương hiệu "Hen ry ếch ti vi" — viết liền mạch vào script, không tách dòng, không dùng ký tự đặc biệt.`;
  }

  return `Viết kịch bản voiceover TTS cho phần video về chủ đề: ${topic}\n\nDữ liệu: ${JSON.stringify(sectionData)}`;
}

app.post('/api/write-section', async (req, res) => {
  const { sectionType, sectionData, topic, videoLength, apiKey } = req.body;

  if (!sectionType || !sectionData || !topic) {
    return res.status(400).json({ error: 'Thiếu thông tin đầu vào' });
  }

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(400).json({ error: 'Chưa cấu hình API key' });
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: SECTION_WRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: buildSectionWritePrompt(sectionType, sectionData, topic, parseInt(videoLength) || 15)
      }]
    });

    const script = response.content[0].text.trim();
    res.json({ success: true, script });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Lỗi không xác định' });
  }
});

function fetchYTSuggestions(query) {
  return new Promise(resolve => {
    const opts = {
      hostname: 'suggestqueries.google.com',
      path: `/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}&hl=vi`,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)[1] || []); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

app.post('/api/youtube-hot-topics', async (req, res) => {
  const { apiKey } = req.body;
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: 'Chưa cấu hình API key' });

  const queries = [
    'kinh dịch bài học cuộc sống', 'tam quốc chí bài học',
    'phật giáo tâm lý', 'quản trị cảm xúc', 'triết học cuộc sống',
    'nghệ thuật sống', 'đạo học','tào tháo', 'trang tử', 'thiền sư', 'quỷ cốc tử', 'Gia Cát Lượng', 'Khổng Tử', 'lão tử', 'thiền định tâm lý'
  ];

  try {
    const results = await Promise.all(queries.map(q => fetchYTSuggestions(q)));
    const suggestions = [...new Set(results.flat())].filter(Boolean).slice(0, 60);

    if (suggestions.length === 0) {
      return res.status(500).json({ error: 'Không lấy được dữ liệu từ YouTube. Kiểm tra kết nối mạng.' });
    }

    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: `Bạn là chuyên gia nội dung YouTube chuyên ngách "Ứng dụng Minh triết Cổ đông vào Quản trị Tâm lý và Nghệ thuật sống". Chỉ trả về JSON array thuần, không markdown.`,
      messages: [{
        role: 'user',
        content: `Đây là các từ khóa người dùng đang tìm kiếm thực tế trên YouTube:\n${suggestions.join(', ')}\n\nTừ dữ liệu tìm kiếm thực tế này, xác định 5 CHỦ ĐỀ VIDEO tiềm năng nhất cho kênh "Ứng dụng Minh triết Cổ đông vào cuộc sống hiện đại". Mỗi chủ đề 4-10 từ, cụ thể, hấp dẫn.\nTrả về JSON array: ["chủ đề 1", ..., "chủ đề 5"]`
      }]
    });

    const topics = extractJSON(response.content[0].text);
    res.json({ success: true, topics, raw_count: suggestions.length });
  } catch (err) {
    if (err instanceof SyntaxError) res.status(500).json({ error: 'Lỗi phân tích dữ liệu. Thử lại.' });
    else res.status(500).json({ error: err.message || 'Lỗi không xác định' });
  }
});

const TOPIC_SUGGEST_SYSTEM = `Bạn là chuyên gia phân tích xu hướng nội dung YouTube tại Việt Nam, chuyên ngành "Ứng dụng Minh triết Cổ đông (Kinh Dịch, Phật giáo, Đạo học, Tam Quốc, Quỷ Cốc Tử, Lão Tử, Khổng Tử, Trang Tử, Phật Thích Ca Mâu Ni) vào Quản trị Tâm lý và Nghệ thuật sống hiện đại".

Tiêu chí chủ đề hot:
1. Đánh trúng nỗi đau tâm lý đang được nhiều người Việt tìm kiếm (áp lực công sở, bị phản bội, cô đơn giữa đám đông, tiền bạc, thất bại, mối quan hệ độc hại, sự kỳ vọng, nỗi sợ...)
2. Có góc nhìn đi ngược đám đông, phá vỡ niềm tin mặc định
3. Áp dụng được triết lý cổ đại (Tam Quốc, Kinh Dịch, Thiền sư, Đạo học, Thiên Địa Nhân, Đạo Giáo, Triết Lý Nhà Phật...) vào tình huống hiện đại cụ thể
4. Tiêu đề nghe hấp dẫn, gây tò mò, có tiềm năng viral tại thị trường Việt Nam
5. Phù hợp video dài 15-20 phút, có chiều sâu triết lý, có bài học sâu sắc

Chỉ trả về JSON thuần: ["chủ đề 1", "chủ đề 2", ..., "chủ đề 10"]
Mỗi chủ đề là một cụm từ ngắn gọn 4-10 từ, đủ để dùng làm topic đầu vào cho generator.`;

app.post('/api/suggest-topics', async (req, res) => {
  const key = req.body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: 'Chưa cấu hình API key' });
  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: TOPIC_SUGGEST_SYSTEM,
      messages: [{
        role: 'user',
        content: 'Gợi ý 10 chủ đề video đang hot hoặc có tiềm năng cao nhất hiện tại trong ngách này. Trả về JSON array thuần, không markdown.'
      }]
    });
    const topics = extractJSON(response.content[0].text);
    if (!Array.isArray(topics)) throw new Error('Phản hồi không hợp lệ');
    res.json({ success: true, topics });
  } catch (err) {
    if (err instanceof SyntaxError) res.status(500).json({ error: 'Lỗi phân tích JSON. Vui lòng thử lại.' });
    else res.status(500).json({ error: err.message || 'Lỗi không xác định' });
  }
});

const SEO_SYSTEM = `Bạn là chuyên gia SEO YouTube, đặc biệt xuất sắc trong ngách "Ứng dụng Minh triết Cổ đông vào Quản trị Tâm lý và Nghệ thuật sống hiện đại". Văn phong triết lý, lạnh lùng, đi ngược đám đông, không sáo rỗng.
QUAN TRỌNG: Chỉ trả về JSON thuần túy, không markdown, không code fence.`;

function buildSeoPrompt(topic, videoLength, outlineParts) {
  return `Tạo bộ dữ liệu SEO cho video YouTube về chủ đề: "${topic}" (${videoLength} phút, ${outlineParts} phần thân bài).

Quy tắc tiêu đề: [Uy danh Cổ nhân/Minh triết] + [Con số đóng gói/Câu hỏi gợi tò mò] + [Giải pháp nỗi đau] + [Từ ngữ cảm xúc cực hạn: Tuyệt đối, Đỉnh cao, Đừng bao giờ...]. Độ dài không quá 70 ký tự
Quy tắc thumbnailPrompt: Tiếng Anh, dưới 500 từ, phong cách triết học phương Đông pha tâm lý học hiện đại, mô tả bố cục + ánh sáng cinematic chiaroscuro + nhân vật ẩn sĩ/tượng Phật/Kinh Dịch + không gian sương mù, TUYỆT ĐỐI KHÔNG yêu cầu text trong ảnh.

Trả về JSON thuần (không markdown):
{
  "titles": ["tiêu đề 1", "tiêu đề 2", "tiêu đề 3"],
  "description": "3-4 câu đậm chất triết lý, chứa từ khóa chính, kích thích click",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "keywords": ["long-tail 1", "long-tail 2", "long-tail 3", "long-tail 4", "long-tail 5"],
  "thumbnailText": "3-5 từ gây sốc hoặc gợi tò mò mạnh",
  "thumbnailPrompt": "English prompt under 500 words for Nanobanana, no text in image"
}`;
}

app.post('/api/generate-seo', async (req, res) => {
  const { topic, videoLength, outlineParts, apiKey } = req.body;
  if (!topic) return res.status(400).json({ error: 'Thiếu thông tin đầu vào' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: 'Chưa cấu hình API key' });
  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: SEO_SYSTEM,
      messages: [{ role: 'user', content: buildSeoPrompt(topic, videoLength || 15, outlineParts || 3) }]
    });
    const data = extractJSON(response.content[0].text);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof SyntaxError) res.status(500).json({ error: 'Lỗi phân tích JSON. Vui lòng thử lại.' });
    else res.status(500).json({ error: err.message || 'Lỗi không xác định' });
  }
});

const IMAGEPROMPT_SYSTEM = `You are an expert at creating sequential image generation prompts for AI image tools like Grok Aurora.
Your specialty is traditional Chinese ink wash painting (水墨画, sumi-e) style illustration for YouTube video content.

STRICT RULES — NO EXCEPTIONS:
1. Return ONLY a valid JSON array of strings. Zero markdown, zero explanation, zero code fences.
2. Format exactly: ["prompt one", "prompt two", ...]
3. Each prompt: 20-35 words, English only, no special characters.
4. Every prompt MUST include the anchor phrase: "traditional Chinese ink wash painting, sumi-e style"
5. NO text, NO calligraphy glyphs, NO watermarks, NO UI elements in any described scene.
6. Prompts are SEQUENTIAL — together they visually narrate the full script from first moment to last.
7. Generate EXACTLY the requested count — not one more, not one less.
8. Vary composition: close-up, wide shot, silhouette, bird's eye — avoid repeating the same framing.`;

function buildImagePromptRequest(sectionType, scriptText, numImages, topic) {
  const sectionLabel = {
    hook: 'opening hook',
    body_part: 'main body argument with historical story',
    realworld: 'real-world practical application',
    outro: 'closing reflection'
  }[sectionType] || sectionType;

  return `Video topic: ${topic}
Section type: ${sectionLabel}
Number of images needed: ${numImages} (one image per 10 seconds of video runtime)

Script content to illustrate:
"""
${scriptText.slice(0, 3000)}
"""

Generate exactly ${numImages} sequential image prompts for Grok Aurora.
Traditional Chinese ink wash painting (水墨画) style throughout.
Images must visually cover the script from beginning to end in order.
Return ONLY the JSON array — no other text.`;
}

app.post('/api/generate-image-prompts', async (req, res) => {
  const { sectionType, scriptText, numImages, topic, apiKey } = req.body;

  if (!scriptText || !numImages || !topic) {
    return res.status(400).json({ error: 'Thiếu thông tin đầu vào' });
  }

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: 'Chưa cấu hình API key' });

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: IMAGEPROMPT_SYSTEM,
      messages: [{
        role: 'user',
        content: buildImagePromptRequest(sectionType, scriptText, numImages, topic)
      }]
    });

    const prompts = extractJSON(response.content[0].text);
    if (!Array.isArray(prompts)) throw new Error('AI không trả về mảng hợp lệ');
    res.json({ success: true, prompts });
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: 'Lỗi phân tích JSON từ AI. Vui lòng thử lại.' });
    } else {
      res.status(500).json({ error: err.message || 'Lỗi không xác định' });
    }
  }
});

const SERIES_SYSTEM = `Bạn là chuyên gia chiến lược nội dung YouTube, chuyên xây dựng series video dài kỳ trong ngách "Ứng dụng Minh triết Cổ đông (Kinh Dịch, Phật giáo, Đạo học, Tam Quốc, Quỷ Cốc Tử) vào Quản trị Tâm lý và Nghệ thuật sống hiện đại".

Nguyên tắc xây dựng series:
1. Mỗi tập là video độc lập có giá trị riêng — nhưng xem theo thứ tự tạo hành trình tri thức hoàn chỉnh
2. Thứ tự: từ "đánh thức tâm lý" → "nền tảng triết học" → "chiều sâu ứng dụng" → "đỉnh điểm thay đổi"
3. Mỗi tập có móc nối sang tập tiếp, giữ người xem quay lại
4. Góc nhìn đi ngược đám đông, phá vỡ niềm tin mặc định
5. Tiêu đề hấp dẫn, gây tò mò, có tiềm năng viral tại Việt Nam

QUAN TRỌNG: Chỉ trả về JSON thuần túy, không markdown, không code fence.`;

app.post('/api/generate-series', async (req, res) => {
  const { theme, apiKey } = req.body;
  if (!theme) return res.status(400).json({ error: 'Thiếu chủ đề lớn (theme)' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: 'Chưa cấu hình API key' });
  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5000,
      system: SERIES_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Xây dựng kế hoạch series nội dung YouTube cho chủ đề lớn: "${theme}"

Series phải có 6-8 tập video, logic chặt chẽ từ đầu đến cuối, mỗi tập khai thác một góc khác nhau.

Trả về JSON thuần (không markdown, không giải thích):
{
  "seriesName": "tên series ngắn gọn ấn tượng",
  "seriesDescription": "mô tả 1-2 câu về hành trình tri thức của cả series",
  "totalEpisodes": 7,
  "postingSchedule": "gợi ý lịch đăng (VD: mỗi thứ 3 hàng tuần)",
  "episodes": [
    {
      "episode": 1,
      "title": "tiêu đề video hấp dẫn gây tò mò",
      "angle": "góc tiếp cận độc đáo của tập này (1 câu)",
      "hookIdea": "câu hook mở đầu gây sốc hoặc tò mò (1 câu)",
      "whyThisOrder": "lý do đứng ở vị trí này trong series (1-2 câu ngắn)",
      "bridgeNext": "câu dẫn sang tập kế — để trống nếu là tập cuối",
      "suggestedDay": "Tuần X — Thứ Y"
    }
  ]
}`
        },
        { role: 'assistant', content: '{' }
      ]
    });
    // Prefill '{' is NOT included in response text — prepend it back
    const raw = '{' + response.content[0].text;
    const data = extractJSON(raw);
    if (!data.episodes || !Array.isArray(data.episodes)) throw new Error('Cấu trúc dữ liệu không hợp lệ');
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof SyntaxError) res.status(500).json({ error: 'Lỗi phân tích JSON từ AI. Vui lòng thử lại.' });
    else res.status(500).json({ error: err.message || 'Lỗi không xác định' });
  }
});

// ── Nanobanana — Gemini via OpenRouter ───────────────────────────────────────
async function _orImageGen(apiKey, model, prompt, size) {
  const body = { model, prompt: prompt.trim(), n: 1, response_format: 'b64_json' };
  if (size) body.size = size;
  const orRes = await fetch('https://openrouter.ai/api/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://henrystv.app',
      'X-Title': 'HenrysTV Script Generator'
    },
    body: JSON.stringify(body)
  });
  const data = await orRes.json();
  if (!orRes.ok) throw new Error(data.error?.message || JSON.stringify(data.error) || 'Lỗi OpenRouter');
  if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data.data?.[0]?.url) {
    const imgFetch = await fetch(data.data[0].url);
    const buf = await imgFetch.arrayBuffer();
    const mime = imgFetch.headers.get('content-type') || 'image/png';
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  }
  throw new Error('Không nhận được ảnh');
}

app.post('/api/nanobanana-gen-image', async (req, res) => {
  const { prompt, apiKey, size } = req.body;
  if (!prompt || !apiKey) return res.status(400).json({ error: 'Thiếu prompt hoặc API key' });
  try {
    const imageData = await _orImageGen(apiKey, 'google/gemini-2.5-flash-image', prompt, size);
    res.json({ imageData });
  } catch (err) {
    console.error('[Nanobanana/Gemini]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── OpenRouter GPT Image Generation ──────────────────────────────────────────
app.post('/api/openrouter-gen-image', async (req, res) => {
  const { prompt, apiKey, size } = req.body;
  if (!prompt || !apiKey) {
    return res.status(400).json({ error: 'Thiếu prompt hoặc OpenRouter API key' });
  }
  try {
    const imageData = await _orImageGen(apiKey, 'openai/gpt-4o-image', prompt, size);
    return res.json({ imageData });
  } catch (err) {
    console.error('[OpenRouter/GPT]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✦ HenrysTV Script Generator đang chạy tại http://localhost:${PORT}\n`);
});
