import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/safeboard";

// [NoSQL Injection 2차 방어] 쿼리 조건에 섞인 $ 연산자를 무력화한다. (의도한 연산자만 mongoose.trusted 로 허용)
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as unknown as { _safeboardMongoose?: Cache };
const cache: Cache = (globalForMongoose._safeboardMongoose ??= { conn: null, promise: null });

/** 개발 모드의 핫 리로드에서 연결이 계속 늘어나지 않도록 전역에 캐시한다. */
export async function connectDB() {
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(MONGODB_URI, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }
  return cache.conn;
}

/** sanitizeFilter 활성화 시 의도적으로 사용하는 MongoDB 연산자($regex, $or 등)만 신뢰 처리한다. */
export const trusted = mongoose.trusted;