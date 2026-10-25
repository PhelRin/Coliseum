// A simple synthetic audio manager to avoid needing external MP3 dependencies
class AudioManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.volume = 1.0;
    }

    setSettings(enabled, volume) {
        this.enabled = enabled;
        this.volume = typeof volume === 'number' ? volume : 1.0;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playMove() {
        if (!this.enabled) return;
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.5 * this.volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playCapture() {
        if (!this.enabled) return;
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // A slightly harsher, higher pitched sound for capture
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.15);

        const noise = this.ctx.createBufferSource();
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
        noise.buffer = buffer;

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.2 * this.volume, this.ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 0.1);
        noise.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        gain.gain.setValueAtTime(0.4 * this.volume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 0.15);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        noise.start();
        osc.stop(this.ctx.currentTime + 0.15);
    }

    playEnd() {
        if (!this.enabled) return;
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, this.ctx.currentTime);
        osc.frequency.setValueAtTime(554, this.ctx.currentTime + 0.2); // C#
        osc.frequency.setValueAtTime(659, this.ctx.currentTime + 0.4); // E

        gain.gain.setValueAtTime(0.3 * this.volume, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3 * this.volume, this.ctx.currentTime + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 1.0);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.0);
    }
}

export const audio = new AudioManager();
