"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Layout({ children }) {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data?.user);
    };
    checkUser();
  }, []);

  return (
    <div>
      <nav className="p-4 bg-gray-800 text-white flex justify-between">
        <span>My App</span>
        {user ? (
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setUser(null);
            }}
            className="bg-red-500 px-4 py-2 rounded"
          >
            Sign Out
          </button>
        ) : (
          <a href="/auth" className="bg-blue-500 px-4 py-2 rounded">Login</a>
        )}
      </nav>
      {children}
    </div>
  );
}
