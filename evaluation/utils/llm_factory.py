from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama
from langchain_anthropic import ChatAnthropic
import os


def llm_factory(llm_type: str, llm_model: str):
    if llm_type == "openai":
        return ChatOpenAI(model=llm_model)
    elif llm_type == "ollama":
        return ChatOllama(model=llm_model)
    elif llm_type == "moonshot":
        return ChatOpenAI(
            model=llm_model,
            base_url="https://api.moonshot.cn/v1",
            api_key=os.getenv("MOONSHOT_API_KEY"),
        )
    elif llm_type == "anthropic":
        return ChatAnthropic(model=llm_model, api_key=os.getenv("ANTHROPIC_API_KEY"))
    else:
        raise ValueError(f"Unsupported LLM type: {llm_type}")
