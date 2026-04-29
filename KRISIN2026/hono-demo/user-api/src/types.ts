export type Bindings = {
    DB: D1Database;
    JWT_SECRET: string;
};

export type Variables = {
    jwtPayload: {
        sub: number;
        email: string;
        role: string;
        exp: number;
    };
};

export type AppEnv = {
    Bindings: Bindings;
    Variables: Variables;
};
