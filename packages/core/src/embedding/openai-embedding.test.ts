import { OpenAI } from 'openai';
import { OpenAIEmbedding } from './openai-embedding';
import type { EmbeddingVector } from './base-embedding';

// Mock the OpenAI client module
const mockEmbeddingsCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: {
      create: mockEmbeddingsCreate,
    },
  }));
});

const MockOpenAI = OpenAI as jest.Mock;

describe('OpenAIEmbedding OAPI Forwarding', () => {
  const originalEnv = process.env;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockEmbeddingsCreate.mockClear();
    MockOpenAI.mockClear();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize for standard OpenAI API by default', () => {
      const embedding = new OpenAIEmbedding({ model: 'text-embedding-3-small', apiKey: 'test-key' });
      expect(embedding['isOllamaViaOAPI']).toBe(false);
      expect(embedding.getDimension()).toBe(1536); 
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Configured for Ollama model'));
    });

    it('should enable OAPI forwarding via config flag useOllamaModel: true', () => {
      const embedding = new OpenAIEmbedding({
        model: 'nomic-embed-text',
        apiKey: 'ollama-key',
        useOllamaModel: true,
      });
      expect(embedding['isOllamaViaOAPI']).toBe(true);
      expect(embedding.getDimension()).toBe(768);
      expect(consoleLogSpy).toHaveBeenCalledWith('[OpenAI] Configured for Ollama model nomic-embed-text via OAPI forwarding');
    });

    it.each([
      ['true'],
      ['True'],
    ])('should enable OAPI forwarding when OPENAI_CUSTOM_BASE_USING_OLLAMA_MODEL is "%s"', (envValue) => {
      process.env.OPENAI_CUSTOM_BASE_USING_OLLAMA_MODEL = envValue;
      const embedding = new OpenAIEmbedding({ model: 'nomic-embed-text', apiKey: 'ollama-key' });
      expect(embedding['isOllamaViaOAPI']).toBe(true);
      expect(embedding.getDimension()).toBe(768);
    });

    it('should not enable OAPI forwarding for other env var values', () => {
      process.env.OPENAI_CUSTOM_BASE_USING_OLLAMA_MODEL = 'false';
      const embedding = new OpenAIEmbedding({ model: 'text-embedding-3-small', apiKey: 'test-key' });
      expect(embedding['isOllamaViaOAPI']).toBe(false);
    });
  });

  describe('baseURL Correction', () => {
    it('should append /v1 to baseURL if missing', () => {
      new OpenAIEmbedding({ model: 'any-model', apiKey: 'key', baseURL: 'http://localhost:8080' });
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: 'http://localhost:8080/v1' });
      expect(consoleLogSpy).toHaveBeenCalledWith('[OpenAI] Auto-correcting baseURL: http://localhost:8080 → http://localhost:8080/v1');
    });

    it('should append /v1 to baseURL with trailing slash', () => {
      new OpenAIEmbedding({ model: 'any-model', apiKey: 'key', baseURL: 'http://localhost:8080/' });
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: 'http://localhost:8080/v1' });
    });

    it('should not modify baseURL if it already contains /v1', () => {
      new OpenAIEmbedding({ model: 'any-model', apiKey: 'key', baseURL: 'http://localhost:8080/v1' });
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: 'http://localhost:8080/v1' });
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Auto-correcting baseURL'));
    });

    it('should not modify official OpenAI API URLs', () => {
      const officialURL = 'https://api.openai.com/v1';
      new OpenAIEmbedding({ model: 'any-model', apiKey: 'key', baseURL: officialURL });
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: officialURL });
    });

    it('should pass undefined baseURL if not provided', () => {
      new OpenAIEmbedding({ model: 'any-model', apiKey: 'key' });
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: undefined });
    });
  });

  describe('OAPI Forwarding (Ollama)', () => {
    const ollamaConfig = { model: 'nomic-embed-text', apiKey: 'ollama-key', useOllamaModel: true };

    it('should use OAPI-specific logic for embed()', async () => {
      const embedding = new OpenAIEmbedding(ollamaConfig);
      const mockVector = Array(768).fill(0.1);
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: mockVector }] });

      const result = await embedding.embed('hello ollama');
      
      expect(result.vector).toEqual(mockVector);
      expect(result.dimension).toBe(768);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'nomic-embed-text',
        input: 'hello ollama',
        encoding_format: 'float',
      });
    });

    it('should detect dimension on first call if default is present', async () => {
      const embedding = new OpenAIEmbedding(ollamaConfig);
      embedding['dimension'] = 1536; 
      
      const detectionVector = Array(768).fill(0.2);
      const embedVector = Array(768).fill(0.3);
      mockEmbeddingsCreate
        .mockResolvedValueOnce({ data: [{ embedding: detectionVector }] })
        .mockResolvedValueOnce({ data: [{ embedding: embedVector }] });

      await embedding.embed('test text');

      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
      expect(embedding.getDimension()).toBe(768);
    });

    it('should throw OAPI-specific error on empty response for embed()', async () => {
      const embedding = new OpenAIEmbedding(ollamaConfig);
      mockEmbeddingsCreate.mockResolvedValue({ data: [] });

      await expect(embedding.embed('test')).rejects.toThrow(
        'OAPI forwarding returned empty response for Ollama model nomic-embed-text. Check OAPI service and Ollama model availability.'
      );
    });

    it('should throw OAPI-specific error on batch mismatch', async () => {
      const embedding = new OpenAIEmbedding(ollamaConfig);
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [1,2,3] }] });

      await expect(embedding.embedBatch(['text1', 'text2'])).rejects.toThrow(
        'OAPI forwarding returned 1 embeddings but expected 2 for Ollama model nomic-embed-text. This indicates: 1) Some texts were rejected by Ollama, 2) OAPI service issues, 3) Ollama model capacity limits. Check OAPI logs and Ollama status.'
      );
    });
  });

  describe('Standard OpenAI Embedding', () => {
    const openaiConfig = { model: 'text-embedding-3-small', apiKey: 'openai-key' };

    it('should generate embedding for a known model', async () => {
      const embedding = new OpenAIEmbedding(openaiConfig);
      const mockVector = Array(1536).fill(0.5);
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: mockVector }] });

      const result = await embedding.embed('hello openai');

      expect(result.vector).toEqual(mockVector);
      expect(result.dimension).toBe(1536);
      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Detecting'));
    });

    it('should detect dimension for unknown model before embedding', async () => {
      const customModelConfig = { model: 'my-custom-model', apiKey: 'openai-key' };
      const embedding = new OpenAIEmbedding(customModelConfig);
      
      const detectionVector = Array(512).fill(0.3);
      const embedVector = Array(512).fill(0.4);
      mockEmbeddingsCreate
        .mockResolvedValueOnce({ data: [{ embedding: detectionVector }] })
        .mockResolvedValueOnce({ data: [{ embedding: embedVector }] });

      const result = await embedding.embed('test');

      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
      expect(embedding.getDimension()).toBe(512);
      expect(result.dimension).toBe(512);
      expect(result.vector).toEqual(embedVector);
    });

    it('should throw specific error for empty API response', async () => {
      const embedding = new OpenAIEmbedding(openaiConfig);
      mockEmbeddingsCreate.mockResolvedValue({ data: [] });

      await expect(embedding.embed('test')).rejects.toThrow(
        'API returned empty response. This might indicate: 1) Incorrect baseURL (missing /v1?), 2) Invalid API key, 3) Model not available, or 4) Input text was filtered out'
      );
    });

    it('should handle batch embeddings correctly', async () => {
      const embedding = new OpenAIEmbedding(openaiConfig);
      const vectors = [Array(1536).fill(0.1), Array(1536).fill(0.2)];
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { embedding: vectors[0] },
          { embedding: vectors[1] },
        ]
      });

      const results = await embedding.embedBatch(['text1', 'text2']);
      expect(results.length).toBe(2);
      expect(results[0].vector).toEqual(vectors[0]);
      expect(results[1].dimension).toBe(1536);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing OpenAI interface without OAPI features', () => {
      const embedding = new OpenAIEmbedding({ 
        model: 'text-embedding-3-small', 
        apiKey: 'test-key' 
      });
      
      // Verify all existing methods still work
      expect(embedding.getProvider()).toBe('OpenAI');
      expect(embedding.getDimension()).toBe(1536);
      expect(typeof embedding.getClient()).toBe('object');
      expect(typeof embedding.setModel).toBe('function');
    });

    it('should support all existing static methods', () => {
      const models = OpenAIEmbedding.getSupportedModels();
      expect(models['text-embedding-3-small']).toBeDefined();
      expect(models['text-embedding-3-large']).toBeDefined();
      expect(models['text-embedding-ada-002']).toBeDefined();
    });
  });
});