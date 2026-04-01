let pipeline = null;

self.onmessage = async (e) => {
  const { type, audioData } = e.data;

  if (type === 'transcribe') {
    try {
      // 1. 모델 로드 (첫 실행만)
      if (!pipeline) {
        self.postMessage({ type: 'status', text: 'Whisper 모델 다운로드 중... (첫 실행만, ~40MB)' });
        const { pipeline: createPipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
        pipeline = await createPipeline('automatic-speech-recognition', 'onnx-community/whisper-small', {
          dtype: 'q4',
          device: 'wasm',
        });
      }

      // 2. 음성 인식
      self.postMessage({ type: 'status', text: '음성 인식 중... (30초~1분 소요)' });

      const result = await pipeline(audioData, {
        language: 'korean',
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      self.postMessage({ type: 'result', result });

    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
