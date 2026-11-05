import { AppConfig } from '../config';
import { DatabaseService } from './database.service';
const database = new DatabaseService(new AppConfig());
database.onModuleDestroy();
console.log('SQLite migrations applied successfully.');
