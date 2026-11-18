from audio_engine import AudioEngine
from looper import DrumLooper


def main():
    engine = AudioEngine(threshold=4.5)
    looper = DrumLooper(engine)

    engine.start()
    print("=== GestureSynth: Drum Looper ===")

    try:
        while True:
            print("\n----------------------------------------")
            print(f"Темп: {looper.bpm} BPM | Цикл: {looper.loop_beats} долей ({looper.get_loop_duration():.2f} сек)")
            print(f"Ударов в памяти: {len(looper.recorded_beats)}")
            print("----------------------------------------")
            print("1. Изменить BPM")
            print("2. Изменить длину цикла (в долях)")
            print("3. Записать ритм с микрофона")
            print("4. Запустить воспроизведение")
            print("5. Настроить чувствительность микрофона")
            print("0. Выход")

            choice = input("\nВыбор (0-5): ").strip()

            if choice == "1":
                try:
                    val = int(input("Новый BPM (30-260): "))
                    if looper.set_bpm(val):
                        print(f"Темп обновлён: {looper.bpm} BPM")
                    else:
                        print("Нужно число от 30 до 260.")
                except ValueError:
                    print("Введи целое число.")

            elif choice == "2":
                try:
                    val = int(input("Длина цикла в долях (например, 4 или 8): "))
                    if looper.set_loop_beats(val):
                        print(f"Длина цикла: {looper.loop_beats} долей ({looper.get_loop_duration():.2f} сек)")
                    else:
                        print("Допустимо от 1 до 32 долей.")
                except ValueError:
                    print("Введи целое число.")

            elif choice == "3":
                print(f"\nЗапись продлится {looper.get_loop_duration():.2f} сек ({looper.loop_beats} долей).")
                input("Нажми Enter для старта и сразу стучи ритм...")
                print("\n[REC] Идёт запись:")
                beats = looper.record_loop()
                print(f"[STOP] Запись завершена. Поймано ударов: {len(beats)} -> {beats}")

            elif choice == "4":
                if not looper.recorded_beats:
                    print("Сначала запиши ритм (пункт 3).")
                    continue

                print(f"\n[PLAY] Крутим цикл на {looper.bpm} BPM...")
                looper.start_playback()
                # Воспроизведение идёт в фоне, здесь просто ждём нажатия Enter для остановки
                input("[Нажми Enter, чтобы остановить]\n")
                looper.stop_playback()
                print("[STOP] Воспроизведение остановлено.")

            elif choice == "5":
                try:
                    print(f"Текущий порог: {engine.threshold} (чем меньше, тем чувствительнее)")
                    val = float(input("Новый порог (например, 3.0 для тихих стуков или 7.0 для хлопков): "))
                    if val > 0.5:
                        engine.threshold = val
                        print(f"Новый порог: {engine.threshold}")
                    else:
                        print("Слишком маленькое значение, будет ловить шум.")
                except ValueError:
                    print("Введи число (например, 4.5).")

            elif choice == "0":
                print("Выход...")
                break
            else:
                print("Нет такого пункта, выбери от 0 до 5.")

    except KeyboardInterrupt:
        print("\nВыход по Ctrl+C...")
    finally:
        looper.stop_playback()
        engine.stop()


if __name__ == "__main__":
    main()