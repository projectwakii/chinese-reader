// Text-to-speech via the Web Speech API. Chinese voice selection: preferred voiceURI,
// then zh-CN, then zh-TW, then any zh* / cmn* voice.

const norm = (lang) => String(lang || '').replace('_', '-').toLowerCase();

/** @param {SpeechSynthesisVoice[]} voices */
export function pickChineseVoice(voices, preferredURI = '') {
  const list = Array.from(voices || []);
  if (preferredURI) {
    const v = list.find((x) => x.voiceURI === preferredURI);
    if (v) return v;
  }
  return (
    list.find((v) => norm(v.lang) === 'zh-cn') ||
    list.find((v) => norm(v.lang).startsWith('zh-hans')) ||
    list.find((v) => norm(v.lang) === 'zh-tw') ||
    list.find((v) => norm(v.lang).startsWith('zh') || norm(v.lang).startsWith('cmn')) ||
    null
  );
}

export function chineseVoices(voices) {
  return Array.from(voices || []).filter((v) => /^(zh|cmn|yue)/.test(norm(v.lang)));
}

export function pickEnglishVoice(voices) {
  const list = Array.from(voices || []);
  return list.find((v) => norm(v.lang) === 'en-us') || list.find((v) => norm(v.lang).startsWith('en')) || null;
}

/**
 * Create speech helpers bound to a speechSynthesis implementation (injectable for tests).
 * @param {{synth?: SpeechSynthesis, Utterance?: typeof SpeechSynthesisUtterance, getPrefs?: () => {voiceURI?:string, rate?:number}}} deps
 */
export function createSpeech(deps = {}) {
  const synth = deps.synth ?? globalThis.speechSynthesis;
  const Utterance = deps.Utterance ?? globalThis.SpeechSynthesisUtterance;
  const getPrefs = deps.getPrefs || (() => ({}));

  const available = () => !!(synth && Utterance);

  function speak(text, lang, voice) {
    if (!available()) return { ok: false, reason: 'Speech synthesis is not supported in this browser.' };
    const prefs = getPrefs();
    synth.cancel?.();
    const u = new Utterance(text);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    u.rate = Number(prefs.rate) || (lang.startsWith('zh') ? 0.85 : 1);
    synth.speak(u);
    return { ok: true, voice: voice?.name || '(system default)', utterance: u };
  }

  /** Speak Chinese text. Returns {ok, reason?}. */
  function speakChinese(text) {
    if (!available()) return { ok: false, reason: 'Speech synthesis is not supported in this browser.' };
    const voices = synth.getVoices?.() || [];
    const voice = pickChineseVoice(voices, getPrefs().voiceURI);
    if (!voice && voices.length) {
      return {
        ok: false,
        reason:
          'No Chinese voice is installed. On iPad: Settings › Accessibility › Spoken Content › Voices › Chinese, then reload.',
      };
    }
    // voices list can be empty before 'voiceschanged' on iOS: still request zh-CN.
    return speak(text, 'zh-CN', voice);
  }

  function speakEnglish(text) {
    if (!available()) return { ok: false, reason: 'Speech synthesis is not supported in this browser.' };
    return speak(text, 'en-US', pickEnglishVoice(synth.getVoices?.() || []));
  }

  function stop() {
    synth?.cancel?.();
  }

  return { speakChinese, speakEnglish, stop, available, voices: () => synth?.getVoices?.() || [] };
}
