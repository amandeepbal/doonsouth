"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignUp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSignIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <input 
        type="email" placeholder="Email" 
        value={email} onChange={(e) => setEmail(e.target.value)}
        className="border p-2 rounded mb-2"
      />
      <input 
        type="password" placeholder="Password" 
        value={password} onChange={(e) => setPassword(e.target.value)}
        className="border p-2 rounded mb-2"
      />
      <button 
        onClick={handleSignUp} 
        disabled={loading}
        className="bg-blue-500 text-white px-4 py-2 rounded mb-2"
      >
        {loading ? "Signing Up..." : "Sign Up"}
      </button>
      <button 
        onClick={handleSignIn} 
        disabled={loading}
        className="bg-green-500 text-white px-4 py-2 rounded"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
}
