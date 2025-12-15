import { defineConfig, env } from "@prisma/config";
import { config } from "dotenv";

config();


export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: env("DATABASE_URL"),
    },
})