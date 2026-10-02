import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    console.log('🔄 Attempting to connect to MongoDB...');
    console.log(`📍 URI: ${process.env.MONGO_URI?.substring(0, 50)}...`);
    
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
      w: 'majority',
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`❌ MongoDB connection failed: ${err.message}`);
    console.error(`Error details:`, err);
    
    // Check if MONGO_URI is set
    if (!process.env.MONGO_URI) {
      console.error('⚠️  MONGO_URI environment variable is not set!');
    }
    
    // Retry after 5 seconds
    console.log('⏳ Retrying connection in 5 seconds...');
    setTimeout(() => connectDB(), 5000);
  }
};

export default connectDB;
