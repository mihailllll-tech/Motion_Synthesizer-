import time
import numpy as np
import sounddevice as sd


class AudioEngine:
    def __init__(self, sample_rate=44100, block_size=512, threshold=4.5):
        self.sample_rate = sample_rate
        self.block_size = block_size
        # Порог срабатывания: 1-3 это обычный фон комнаты, выше 4.5 — уже хлопок или стук
        self.threshold = threshold

        self.is_recording = False
        self.raw_hit_times = []
        self.record_start_time = 0.0

        # Защита от дребезга (debounce), чтобы один громкий стук не записался дважды
        self.cooldown_sec = 0.12
        self.last_hit_time = -1.0

        # Генерим простой звук бочки на старте, чтобы не таскать с собой wav-файлы
        self.drum_sound = self._generate_kick_sound()
        self.play_cursor = len(self.drum_sound)  # когда курсор в конце, в динамиках тишина

        self.stream = None

    def _generate_kick_sound(self):
        # Делаем короткий (60 мс) синус со спадом частоты со 180 до 40 Гц
        duration = 0.06
        t = np.linspace(0, duration, int(self.sample_rate * duration), endpoint=False)
        freqs = np.linspace(180, 40, len(t))
        envelope = np.exp(-t * 35)  # экспоненциальное затухание, чтобы не было щелчка в конце
        wave = np.sin(2 * np.pi * freqs * t) * envelope * 0.5
        # sounddevice ждёт двумерный массив (frames, channels)
        return wave.reshape(-1, 1).astype(np.float32)

    def trigger_drum(self):
        # Просто ставим курсор в начало сэмпла — колбэк сам подхватит и проиграет
        self.play_cursor = 0

    def audio_callback(self, indata, outdata, frames, time_info, status):
        if status:
            print(f"[Audio status]: {status}")

        # 1. Запись: анализируем вход с микрофона, если включена запись
        if self.is_recording:
            volume = np.linalg.norm(indata) * 10

            if volume > self.threshold:
                now = time.time() - self.record_start_time
                if (now - self.last_hit_time) >= self.cooldown_sec:
                    self.raw_hit_times.append(now)
                    self.last_hit_time = now
                    level = "#" * min(int(volume), 20)
                    print(f"[HIT] {now:.2f}s | {level}")

        # 2. Воспроизведение: отдаём сэмпл удара в колонки
        # indata в outdata НЕ кидаем, иначе без наушников пойдёт свист
        if self.play_cursor < len(self.drum_sound):
            chunk = self.drum_sound[self.play_cursor : self.play_cursor + frames]
            outdata[: len(chunk)] = chunk
            if len(chunk) < frames:
                outdata[len(chunk) :].fill(0)
            self.play_cursor += frames
        else:
            outdata.fill(0)

    def start(self):
        self.stream = sd.Stream(
            samplerate=self.sample_rate,
            blocksize=self.block_size,
            channels=1,
            dtype="float32",
            callback=self.audio_callback,
        )
        self.stream.start()

    def stop(self):
        if self.stream:
            self.stream.stop()
            self.stream.close()

    def start_recording(self):
        self.raw_hit_times = []
        self.last_hit_time = -1.0
        self.record_start_time = time.time()
        self.is_recording = True

    def stop_recording(self):
        self.is_recording = False
        return self.raw_hit_times