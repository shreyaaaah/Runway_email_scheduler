declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatar?: string | null;
    }
  }
}

export {};
