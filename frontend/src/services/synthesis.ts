export interface SynthesisProvider {
  play(
    text: string,
    voiceURI: string,
    rate: number,
    onEnd: () => void,
    onError: () => void,
  ): void;
  stop(): void;
}
export class BrowserSynthesis implements SynthesisProvider {
  private utterance: SpeechSynthesisUtterance | null = null;
  play(
    text: string,
    voiceURI: string,
    rate: number,
    onEnd: () => void,
    onError: () => void,
  ) {
    if (!("speechSynthesis" in window)) {
      onError();
      return;
    }
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, ""));
    utterance.voice =
      window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI) ||
      null;
    utterance.rate = rate;
    this.utterance = utterance;
    utterance.onend = () => {
      if (this.utterance === utterance) {
        this.utterance = null;
        onEnd();
      }
    };
    utterance.onerror = () => {
      if (this.utterance === utterance) {
        this.utterance = null;
        onError();
      }
    };
    window.speechSynthesis.speak(utterance);
  }
  stop() {
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}
